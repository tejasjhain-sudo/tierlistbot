import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import prisma from '../../database/prisma';
import { COLORS, MODES, TIERS, Mode, Region, Tier } from '../../config/constants';
import { updateTierRole } from '../../services/roleService';
import { buildResultEmbed, buildHistoryEmbed } from '../../services/ticketService';
import { fetchMinecraftProfile, getPlayerHeadUrl } from '../../services/minecraftService';

export default {
  data: new SlashCommandBuilder()
    .setName('set-tier')
    .setDescription('[Admin/Staff] Manually add or update a player\'s tier result directly to the website.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addStringOption(opt =>
      opt
        .setName('mode')
        .setDescription('The gamemode being evaluated')
        .setRequired(true)
        .addChoices(
          { name: 'Sword', value: 'sword' },
          { name: 'Axe', value: 'axe' },
          { name: 'Netherite Pot', value: 'nethpot' },
          { name: 'Diamond Pot', value: 'dpot' },
          { name: 'UHC', value: 'uhc' },
          { name: 'SMP', value: 'smp' },
          { name: 'Crystal', value: 'crystal' },
          { name: 'Mace', value: 'mace' }
        )
    )
    .addStringOption(opt =>
      opt
        .setName('tier')
        .setDescription('The tier rank earned')
        .setRequired(true)
        .addChoices(
          { name: 'High Tier 1 (HT1)', value: 'HT1' },
          { name: 'Low Tier 1 (LT1)', value: 'LT1' },
          { name: 'High Tier 2 (HT2)', value: 'HT2' },
          { name: 'Low Tier 2 (LT2)', value: 'LT2' },
          { name: 'High Tier 3 (HT3)', value: 'HT3' },
          { name: 'Low Tier 3 (LT3)', value: 'LT3' },
          { name: 'High Tier 4 (HT4)', value: 'HT4' },
          { name: 'Low Tier 4 (LT4)', value: 'LT4' },
          { name: 'High Tier 5 (HT5)', value: 'HT5' },
          { name: 'Low Tier 5 (LT5)', value: 'LT5' },
          { name: 'Unranked', value: 'Unranked' },
          { name: 'Retired', value: 'Retired' }
        )
    )
    .addUserOption(opt =>
      opt
        .setName('player')
        .setDescription('Discord user to set tier for (optional if Minecraft IGN provided)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName('ign')
        .setDescription('Minecraft IGN to set tier for (optional if Discord user provided)')
        .setRequired(false)
    )
    .addUserOption(opt =>
      opt
        .setName('tester')
        .setDescription('Staff member who conducted the test (defaults to you)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName('notes')
        .setDescription('Test score or evaluator notes (e.g. 10-4, solid pot conservation)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName('evidence')
        .setDescription('Video / screenshot proof URL')
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt
        .setName('post-result')
        .setDescription('Post the result embed to the #results channel? (default: true)')
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt
        .setName('dm-player')
        .setDescription('Send a direct message to the player? (default: true)')
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Must be used inside a server.', ephemeral: true });
    }

    const guild = interaction.guild;
    const isOwner = guild.ownerId === interaction.user.id;
    const isAdminPerm = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);

    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};
    const isTierAdmin = roleIds.tierAdmin && member?.roles.cache.has(roleIds.tierAdmin);
    const isTierManager = roleIds.tierManager && member?.roles.cache.has(roleIds.tierManager);
    const isTester = roleIds.tierTester && member?.roles.cache.has(roleIds.tierTester);

    if (!isOwner && !isAdminPerm && !isTierAdmin && !isTierManager && !isTester) {
      return interaction.reply({
        content: '❌ You must be a **Tier Tester**, **Tier Manager**, or **Administrator** to use `/set-tier`.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: false });

    const mode = interaction.options.getString('mode', true) as Mode;
    const earnedTier = interaction.options.getString('tier', true) as Tier;
    const targetUser = interaction.options.getUser('player');
    const targetIgn = interaction.options.getString('ign')?.trim();
    const testerUser = interaction.options.getUser('tester') || interaction.user;
    const notes = interaction.options.getString('notes')?.trim() || null;
    const evidenceUrl = interaction.options.getString('evidence')?.trim() || null;
    const postResult = interaction.options.getBoolean('post-result') ?? true;
    const dmPlayer = interaction.options.getBoolean('dm-player') ?? true;

    if (!targetUser && !targetIgn) {
      return interaction.editReply({ content: '❌ You must provide either a **`player`** (Discord user) or a **`ign`** (Minecraft username).' });
    }

    // Find or create Player record
    let player = null;
    if (targetUser) {
      player = await prisma.player.findUnique({
        where: { discordId: targetUser.id },
        include: { tiers: true },
      });
    }

    if (!player && targetIgn) {
      player = await prisma.player.findUnique({
        where: { minecraftUsernameLower: targetIgn.toLowerCase() },
        include: { tiers: true },
      });
    }

    // If still not found and IGN provided, fetch profile from Mojang
    if (!player) {
      const mcUsername = targetIgn || (targetUser ? targetUser.username : 'Unknown');
      const profile = await fetchMinecraftProfile(mcUsername);
      const uuid = profile?.id ?? null;
      const finalIgn = profile?.name ?? mcUsername;

      const discordIdToUse = targetUser ? targetUser.id : `manual_${Date.now()}`;

      player = await prisma.player.create({
        data: {
          discordId: discordIdToUse,
          minecraftUsername: finalIgn,
          minecraftUsernameLower: finalIgn.toLowerCase(),
          minecraftUuid: uuid,
          region: 'AS',
          preferredMode: mode,
        },
        include: { tiers: true },
      });
    }

    // Existing tier for this mode
    const existingTierRecord = player.tiers?.find((t: any) => t.mode === mode);
    const previousTier = (existingTierRecord?.currentTier as Tier) || null;

    // Database updates in transaction
    await prisma.$transaction(async (tx) => {
      // Upsert PlayerTier
      await tx.playerTier.upsert({
        where: {
          playerId_mode: {
            playerId: player.id,
            mode,
          },
        },
        update: {
          currentTier: earnedTier,
          previousTier,
          lastTestedAt: new Date(),
          lastTesterDiscordId: testerUser.id,
        },
        create: {
          playerId: player.id,
          mode,
          currentTier: earnedTier,
          previousTier,
          lastTestedAt: new Date(),
          lastTesterDiscordId: testerUser.id,
        },
      });

      // Insert TierHistory
      await tx.tierHistory.create({
        data: {
          playerId: player.id,
          guildId: guild.id,
          testerDiscordId: testerUser.id,
          mode,
          region: (player.region as Region) || 'AS',
          previousTier,
          earnedTier,
          notes,
          evidenceUrl,
          sessionId: `manual-${Date.now().toString().slice(-6)}`,
        },
      });

      // Log Audit
      await tx.auditLog.create({
        data: {
          guildId: guild.id,
          actorDiscordId: interaction.user.id,
          action: 'MANUAL_SET_TIER',
          targetDiscordId: player.discordId,
          metadata: {
            mode,
            earnedTier,
            previousTier,
            testerDiscordId: testerUser.id,
            notes,
            evidenceUrl,
          },
        },
      });
    });

    // Assign Discord role if user is in server
    let roleAssigned = false;
    let targetMember = null;
    if (player.discordId && !player.discordId.startsWith('manual_')) {
      try {
        targetMember = await guild.members.fetch(player.discordId).catch(() => null);
        if (targetMember) {
          await updateTierRole(targetMember, mode, previousTier, earnedTier);
          const TESTED_ROLE_ID = '1525776685675577457';
          try { await targetMember.roles.add(TESTED_ROLE_ID); } catch {}
          roleAssigned = true;
        }
      } catch (e) {
        console.error('Failed to update roles for member:', e);
      }
    }

    // Post to Results channel if enabled
    if (postResult) {
      try {
        const channelIds = (guildConfig?.channelIds as Record<string, string>) || {};
        const earnedTierRoleId = roleIds?.tiers?.[mode]?.[earnedTier];

        const resultEmbed = buildResultEmbed({
          minecraftUsername: player.minecraftUsername,
          minecraftUuid: player.minecraftUuid,
          testerDiscordId: testerUser.id,
          mode,
          region: (player.region as Region) || 'AS',
          previousTier,
          earnedTier,
          earnedTierRoleId,
          sessionId: `manual-${Date.now().toString().slice(-6)}`,
          notes: notes ?? undefined,
          evidenceUrl: evidenceUrl ?? undefined,
        });

        const updatesChannel = guild.channels.cache.get(channelIds?.updates) as TextChannel | undefined;
        if (updatesChannel) {
          const mentionText = (!player.discordId.startsWith('manual_')) ? `<@${player.discordId}>` : `**${player.minecraftUsername}**`;
          const msg = await updatesChannel.send({
            content: mentionText,
            embeds: [resultEmbed],
          });
          try { await msg.react('🏆'); } catch {}
        }
      } catch (e) {
        console.error('Error posting manual result to results channel:', e);
      }
    }

    // Send DM to player if enabled
    if (dmPlayer && targetMember) {
      try {
        await targetMember.send(
          `🏆 **Tier Evaluation Result!**\n` +
          `**Gamemode:** ${MODES[mode]}\n` +
          `**Earned Tier:** \`${earnedTier}\`\n` +
          (notes ? `**Notes:** ${notes}\n` : '') +
          `\nYour ranking has been recorded and updated on the live website leaderboard!`
        );
      } catch {}
    }

    // Reply embed
    const headUrl = getPlayerHeadUrl(player.minecraftUuid ?? player.minecraftUsername);
    const replyEmbed = new EmbedBuilder()
      .setTitle('✅ Tier Result Added Successfully!')
      .setThumbnail(headUrl)
      .setDescription(
        `Successfully evaluated and updated **${player.minecraftUsername}**!\n\n` +
        `🎮 **Minecraft IGN:** \`${player.minecraftUsername}\`\n` +
        `👤 **Discord User:** ${player.discordId.startsWith('manual_') ? '_Not linked_' : `<@${player.discordId}>`}\n` +
        `⚔️ **Mode:** **${MODES[mode]}**\n` +
        `📊 **Tier:** \`${previousTier || 'Unranked'}\` ➔ **\`${earnedTier}\`**\n` +
        `🛡️ **Evaluated By:** <@${testerUser.id}>\n` +
        (notes ? `📝 **Notes/Score:** ${notes}\n` : '') +
        (evidenceUrl ? `🔗 **Evidence:** [Proof Link](${evidenceUrl})\n` : '') +
        `\n🌐 **Website & API:** Updated live on database and leaderboards.`
      )
      .setColor(COLORS.SUCCESS)
      .setTimestamp();

    return interaction.editReply({ embeds: [replyEmbed] });
  },
};
