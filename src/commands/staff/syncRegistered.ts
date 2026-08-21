import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import prisma from '../../database/prisma';
import { COLORS, Mode, Tier } from '../../config/constants';
import { giveRegisteredRole, updateTierRole } from '../../services/roleService';

export default {
  data: new SlashCommandBuilder()
    .setName('sync-registered')
    .setDescription('Add the Registered role to all registered players in this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption(opt =>
      opt
        .setName('sync-tiers')
        .setDescription('Also assign saved mode tier roles to players (default: true)')
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt
        .setName('update-nicknames')
        .setDescription('Set server nicknames to Minecraft IGNs (default: false)')
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) {
      return interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
    }

    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdminPerm = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;

    // Check if Tier Admin role is held
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

    const isTierAdmin = roleIds.tierAdmin && member?.roles.cache.has(roleIds.tierAdmin);

    if (!isOwner && !isAdminPerm && !isTierAdmin) {
      return interaction.reply({
        content: '❌ You must be an **Administrator**, **Server Owner**, or **Tier Admin** to use this command.',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const syncTiers = interaction.options.getBoolean('sync-tiers') ?? true;
    const updateNicknames = interaction.options.getBoolean('update-nicknames') ?? false;

    // 1. Fetch all registered players from PostgreSQL DB
    const players = await prisma.player.findMany({
      include: {
        tiers: true,
      },
    });

    if (players.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('👥 Registered Players Sync')
        .setDescription('⚠️ No registered players found in the database.')
        .setColor(COLORS.WARNING);
      return interaction.editReply({ embeds: [embed] });
    }

    // 2. Fetch all members in this server
    await interaction.guild.members.fetch().catch((err) => {
      console.warn('Failed to fetch all guild members, using cache:', err);
    });

    // 3. Ensure Registered Role
    let registeredRoleId = roleIds.registered;
    let registeredRole = registeredRoleId ? interaction.guild.roles.cache.get(registeredRoleId) : null;

    if (!registeredRole) {
      registeredRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'registered') || null;
    }

    if (!registeredRole) {
      try {
        registeredRole = await interaction.guild.roles.create({
          name: 'Registered',
          color: 0x2ECC71,
          reason: 'Auto-created by /sync-registered',
        });
        if (guildConfig) {
          const updatedRoleIds = { ...roleIds, registered: registeredRole.id };
          await prisma.guildConfig.update({
            where: { guildId: interaction.guild.id },
            data: { roleIds: updatedRoleIds },
          });
        }
      } catch (e) {
        console.error('Failed to create Registered role:', e);
      }
    }

    let countFound = 0;
    let countRoleAdded = 0;
    let countAlreadyHadRole = 0;
    let countFailed = 0;
    let countNickUpdated = 0;
    let countTiersSynced = 0;

    // 4. Iterate over players
    for (const player of players) {
      const guildMember = interaction.guild.members.cache.get(player.discordId);

      if (!guildMember) {
        continue;
      }

      countFound++;

      // Add registered role
      if (registeredRole) {
        if (guildMember.roles.cache.has(registeredRole.id)) {
          countAlreadyHadRole++;
        } else {
          try {
            await guildMember.roles.add(registeredRole);
            countRoleAdded++;
          } catch (err) {
            console.error(`Could not add Registered role to ${guildMember.user.tag}:`, err);
            countFailed++;
          }
        }
      } else {
        try {
          await giveRegisteredRole(guildMember);
          countRoleAdded++;
        } catch (err) {
          countFailed++;
        }
      }

      // Sync Tiers if requested
      if (syncTiers && player.tiers && player.tiers.length > 0) {
        let tierSyncedForPlayer = false;
        for (const playerTier of player.tiers) {
          try {
            await updateTierRole(guildMember, playerTier.mode as Mode, null, playerTier.currentTier as Tier);
            tierSyncedForPlayer = true;
          } catch {}
        }
        if (tierSyncedForPlayer) countTiersSynced++;
      }

      // Update Nickname if requested
      if (updateNicknames && player.minecraftUsername) {
        if (guildMember.id !== interaction.guild.ownerId && guildMember.manageable) {
          try {
            if (guildMember.nickname !== player.minecraftUsername) {
              await guildMember.setNickname(player.minecraftUsername, 'Registered IGN Sync');
              countNickUpdated++;
            }
          } catch {}
        }
      }
    }

    const notInServer = players.length - countFound;

    const embed = new EmbedBuilder()
      .setTitle('✅ Registered Players Added & Synced')
      .setDescription(
        `Successfully processed registered players for **${interaction.guild.name}**!`
      )
      .addFields(
        { name: '📊 Total Registered Players in Database', value: `\`${players.length}\``, inline: true },
        { name: '🎯 Found in this Server', value: `\`${countFound}\``, inline: true },
        { name: '🌐 Not in this Server', value: `\`${notInServer}\``, inline: true },
        { name: '➕ Registered Role Added', value: `\`${countRoleAdded}\``, inline: true },
        { name: '✔️ Already Had Role', value: `\`${countAlreadyHadRole}\``, inline: true },
        { name: '❌ Failed to Add Role', value: `\`${countFailed}\``, inline: true },
        ...(syncTiers ? [{ name: '⚔️ Tiers Synced', value: `\`${countTiersSynced}\` players`, inline: true }] : []),
        ...(updateNicknames ? [{ name: '🏷️ Nicknames Updated', value: `\`${countNickUpdated}\``, inline: true }] : []),
      )
      .setColor(COLORS.SUCCESS)
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
