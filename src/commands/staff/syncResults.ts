import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  TextChannel,
} from 'discord.js';
import prisma from '../../database/prisma';
import { COLORS, MODES, Mode, Region, Tier } from '../../config/constants';
import { buildResultEmbed } from '../../services/ticketService';

export default {
  data: new SlashCommandBuilder()
    .setName('sync-results')
    .setDescription('Copy and post all past tier test results into a channel in this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt =>
      opt
        .setName('channel')
        .setDescription('Channel to post results in (default: configured updates/results channel)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName('mode')
        .setDescription('Filter results by gamemode (default: all modes)')
        .setRequired(false)
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
    if (!interaction.guild || !interaction.member) {
      return interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
    }

    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdminPerm = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;

    // Check if Tier Admin role is held
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};
    const channelIds = (guildConfig?.channelIds as Record<string, any>) ?? {};

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const isTierAdmin = roleIds.tierAdmin && member?.roles.cache.has(roleIds.tierAdmin);

    if (!isOwner && !isAdminPerm && !isTierAdmin) {
      return interaction.reply({
        content: '❌ You must be an **Administrator**, **Server Owner**, or **Tier Admin** to use this command.',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const targetChannelOption = interaction.options.getChannel('channel') as TextChannel | null;
    const modeFilter = interaction.options.getString('mode') as Mode | null;

    // Determine target channel
    let targetChannel: TextChannel | null = targetChannelOption;

    if (!targetChannel) {
      const configuredChannelId = channelIds.updates || channelIds.history;
      if (configuredChannelId) {
        const ch = interaction.guild.channels.cache.get(configuredChannelId);
        if (ch && ch.isTextBased()) {
          targetChannel = ch as TextChannel;
        }
      }
    }

    if (!targetChannel) {
      const embed = new EmbedBuilder()
        .setTitle('❌ Target Channel Not Found')
        .setDescription(
          'Please specify a text channel in the command option (e.g. `/sync-results channel: #tier-updates`) or configure a results channel first using `/result channel add`.'
        )
        .setColor(COLORS.DANGER);
      return interaction.editReply({ embeds: [embed] });
    }

    // Fetch history records from database
    const historyRecords = await prisma.tierHistory.findMany({
      where: modeFilter ? { mode: modeFilter } : undefined,
      include: {
        player: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (historyRecords.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('📜 Tier Results Sync')
        .setDescription(
          modeFilter
            ? `⚠️ No past tier test results found for mode **${MODES[modeFilter]}**.`
            : '⚠️ No past tier test results found in the database.'
        )
        .setColor(COLORS.WARNING);
      return interaction.editReply({ embeds: [embed] });
    }

    let countPosted = 0;
    let countFailed = 0;

    // Loop through history records and send result embeds to targetChannel
    for (const record of historyRecords) {
      const earnedTierRoleId = roleIds.tiers?.[record.mode]?.[record.earnedTier];
      const embed = buildResultEmbed({
        minecraftUsername: record.player.minecraftUsername,
        minecraftUuid: record.player.minecraftUuid,
        testerDiscordId: record.testerDiscordId,
        mode: record.mode as Mode,
        region: record.region as Region,
        previousTier: (record.previousTier as Tier) || null,
        earnedTier: record.earnedTier as Tier,
        earnedTierRoleId,
        sessionId: record.sessionId ?? record.id,
        notes: record.notes ?? undefined,
        evidenceUrl: record.evidenceUrl ?? undefined,
      });

      try {
        await targetChannel.send({ embeds: [embed] });
        countPosted++;
        await new Promise(resolve => setTimeout(resolve, 250));
      } catch (err) {
        console.error(`Failed to post result for ${record.player.minecraftUsername}:`, err);
        countFailed++;
      }
    }

    const summaryEmbed = new EmbedBuilder()
      .setTitle('✅ Tier Test Results Posted to New Server!')
      .setDescription(`Successfully sent past tier test results into <#${targetChannel.id}>!`)
      .addFields(
        { name: '📜 Total Results Processed', value: `\`${historyRecords.length}\``, inline: true },
        { name: '📤 Posted Successfully', value: `\`${countPosted}\``, inline: true },
        ...(countFailed > 0 ? [{ name: '❌ Failed to Post', value: `\`${countFailed}\``, inline: true }] : []),
        { name: '📍 Destination Channel', value: `<#${targetChannel.id}>`, inline: true },
        ...(modeFilter ? [{ name: '⚔️ Filtered Mode', value: MODES[modeFilter], inline: true }] : []),
      )
      .setColor(COLORS.SUCCESS)
      .setTimestamp();

    return interaction.editReply({ embeds: [summaryEmbed] });
  },
};
