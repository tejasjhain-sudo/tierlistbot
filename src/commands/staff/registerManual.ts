import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import prisma from '../../database/prisma';
import { fetchMinecraftProfile } from '../../services/minecraftService';
import { COLORS } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('register-manual')
    .setDescription('[Staff] Manually register an offline/non-Discord player.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(opt =>
      opt.setName('ign').setDescription('Minecraft Username').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('region')
        .setDescription('Preferred Region')
        .setRequired(true)
        .addChoices(
          { name: 'Asia (AS)', value: 'AS' },
          { name: 'Europe (EU)', value: 'EU' },
          { name: 'North America (NA)', value: 'NA' },
          { name: 'Australia (AU)', value: 'AU' },
          { name: 'South America (SA)', value: 'SA' },
          { name: 'Middle East (ME)', value: 'ME' }
        )
    )
    .addStringOption(opt =>
      opt.setName('mode')
        .setDescription('Preferred Gamemode')
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
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: 'Must be run in a server.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    const ign = interaction.options.getString('ign', true);
    const region = interaction.options.getString('region', true);
    const mode = interaction.options.getString('mode', true);

    // Verify staff permissions
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdminPerm = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    const isStaff = isOwner || isAdminPerm 
      || (roleIds.tierAdmin && member?.roles.cache.has(roleIds.tierAdmin))
      || (roleIds.tierManager && member?.roles.cache.has(roleIds.tierManager));

    if (!isStaff) {
      return interaction.editReply({ content: '❌ Only Tier staff can use this command.' });
    }

    // Check if player already registered by MC username
    const existing = await prisma.player.findUnique({
      where: { minecraftUsernameLower: ign.toLowerCase() },
    });

    if (existing) {
      return interaction.editReply({ content: `❌ A player with the Minecraft IGN **${ign}** is already registered (Discord: <@${existing.discordId}>).` });
    }

    // Attempt to fetch actual profile UUID from Mojang
    const profile = await fetchMinecraftProfile(ign);
    const finalIgn = profile ? profile.name : ign;
    const finalUuid = profile ? profile.id : `offline-${ign.toLowerCase()}`;

    // Create manual offline player in DB
    const dummyDiscordId = `offline_${ign.toLowerCase()}`;

    try {
      await prisma.player.create({
        data: {
          discordId: dummyDiscordId,
          minecraftUsername: finalIgn,
          minecraftUsernameLower: finalIgn.toLowerCase(),
          minecraftUuid: finalUuid,
          region: region as any,
          preferredMode: mode as any,
        },
      });

      const embed = new EmbedBuilder()
        .setTitle('✅ Manual Registration Successful')
        .setDescription(`Successfully registered player **${finalIgn}** manually without Discord.`)
        .addFields(
          { name: '🎮 IGN', value: `\`${finalIgn}\``, inline: true },
          { name: '🌍 Region', value: `\`${region}\``, inline: true },
          { name: '⚔️ Preferred Mode', value: `\`${mode}\``, inline: true },
          { name: '🆔 Fake Discord ID', value: `\`${dummyDiscordId}\``, inline: true }
        )
        .setColor(COLORS.SUCCESS)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Failed to create manual registration:', err);
      return interaction.editReply({ content: '❌ Failed to write registration to database. Check if username is already registered.' });
    }
  },
};
