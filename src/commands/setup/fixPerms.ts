import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  TextChannel,
  VoiceChannel,
  ChannelType,
} from 'discord.js';
import prisma from '../../database/prisma';
import { MODE_LIST, MODES, COLORS } from '../../config/constants';

const READ_ONLY_KEYWORDS = [
  'welcome',
  'rules',
  'announcement',
  'community-announcements',
  'updates',
  'events',
  'testing-rules',
  'results',
  'high-results',
  'rubric',
  'verified-servers',
  'booster-perks',
  'boosters',
  'poll-of-the-day',
  'request-test',
  'website',
  'my-channels',
  'fusion-network-as',
  'ocean-scanner',
  'clout-universe',
  'papernodes',
  'championsmc',
  'how-to-test',
  'tier-leaderboard',
  'tier-updates',
  'test-history',
];

const STAFF_KEYWORDS = [
  'staff-controls',
  'bot-logs',
  'staff-movements',
  'punishments',
  'retirement-demotions',
];

export default {
  data: new SlashCommandBuilder()
    .setName('set-all-perms')
    .setDescription('Automatically set channel permission overwrites on all server channels.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ This command must be used in a server.', ephemeral: true });
    }

    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;

    if (!isOwner && !isAdmin) {
      return interaction.reply({
        content: '❌ Only Administrators or Server Owners can run this command.',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const guild = interaction.guild;
    const everyoneRole = guild.roles.everyone;

    // Fetch GuildConfig for role IDs
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};

    const tierTesterRole = roleIds.tierTester ? guild.roles.cache.get(roleIds.tierTester) : guild.roles.cache.find(r => r.name.toLowerCase() === 'tier tester');
    const tierManagerRole = roleIds.tierManager ? guild.roles.cache.get(roleIds.tierManager) : guild.roles.cache.find(r => r.name.toLowerCase() === 'tier manager');
    const tierAdminRole = roleIds.tierAdmin ? guild.roles.cache.get(roleIds.tierAdmin) : guild.roles.cache.find(r => r.name.toLowerCase() === 'tier admin');

    let readOnlyCount = 0;
    let staffOnlyCount = 0;
    let waitlistCount = 0;
    let voiceCount = 0;

    for (const [, channel] of guild.channels.cache) {
      const cleanName = channel.name.toLowerCase().replace(/[^a-z0-9-]/g, '');

      // Voice Channels
      if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
        const voiceCh = channel as VoiceChannel;
        if (cleanName.includes('members')) {
          try {
            await voiceCh.permissionOverwrites.edit(everyoneRole, {
              ViewChannel: true,
              Connect: false,
            });
            voiceCount++;
          } catch {}
        } else {
          try {
            await voiceCh.permissionOverwrites.edit(everyoneRole, {
              ViewChannel: true,
              Connect: true,
            });
            voiceCount++;
          } catch {}
        }
        continue;
      }

      if (!channel.isTextBased() || channel.isThread()) continue;
      const textChannel = channel as TextChannel;

      // Staff Channels
      if (STAFF_KEYWORDS.some(k => cleanName.includes(k))) {
        try {
          await textChannel.permissionOverwrites.edit(everyoneRole, {
            ViewChannel: false,
          });
          if (tierTesterRole) await textChannel.permissionOverwrites.edit(tierTesterRole, { ViewChannel: true, SendMessages: true });
          if (tierManagerRole) await textChannel.permissionOverwrites.edit(tierManagerRole, { ViewChannel: true, SendMessages: true });
          if (tierAdminRole) await textChannel.permissionOverwrites.edit(tierAdminRole, { ViewChannel: true, SendMessages: true });
          staffOnlyCount++;
        } catch {}
        continue;
      }

      // Read-Only Channels
      if (READ_ONLY_KEYWORDS.some(k => cleanName.includes(k))) {
        try {
          await textChannel.permissionOverwrites.edit(everyoneRole, {
            ViewChannel: true,
            SendMessages: false,
          });
          if (tierAdminRole) await textChannel.permissionOverwrites.edit(tierAdminRole, { ViewChannel: true, SendMessages: true });
          readOnlyCount++;
        } catch {}
        continue;
      }

      // Waitlist Channels
      let isWaitlist = false;
      for (const mode of MODE_LIST) {
        if (cleanName.includes(`waitlist-${mode}`)) {
          isWaitlist = true;
          const waitlistRoleId = roleIds.waitlists?.[mode];
          const testerRoleId = roleIds.testers?.[mode];

          const waitlistRole = waitlistRoleId ? guild.roles.cache.get(waitlistRoleId) : guild.roles.cache.find(r => r.name.toLowerCase() === `waitlist ${MODES[mode]}`.toLowerCase());
          const testerRole = testerRoleId ? guild.roles.cache.get(testerRoleId) : guild.roles.cache.find(r => r.name.toLowerCase() === `${MODES[mode]} tester`.toLowerCase());

          try {
            await textChannel.permissionOverwrites.edit(everyoneRole, {
              ViewChannel: false,
              SendMessages: false,
            });
            if (waitlistRole) await textChannel.permissionOverwrites.edit(waitlistRole, { ViewChannel: true, SendMessages: false });
            if (testerRole) await textChannel.permissionOverwrites.edit(testerRole, { ViewChannel: true, SendMessages: true });
            if (tierAdminRole) await textChannel.permissionOverwrites.edit(tierAdminRole, { ViewChannel: true, SendMessages: true });
            waitlistCount++;
          } catch {}
          break;
        }
      }

      if (isWaitlist) continue;

      // Default Open Text Channels (chit-chat, media, commands, etc.)
      try {
        await textChannel.permissionOverwrites.edit(everyoneRole, {
          ViewChannel: true,
          SendMessages: true,
        });
      } catch {}
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Channel Permissions Set Across Server!')
      .setDescription(`Successfully applied permission overwrites to all channels for **${guild.name}**!`)
      .addFields(
        { name: '📖 Read-Only Channels Set', value: `\`${readOnlyCount}\` channels`, inline: true },
        { name: '🔒 Staff-Only Channels Set', value: `\`${staffOnlyCount}\` channels`, inline: true },
        { name: '⚔️ Waitlist Channels Set', value: `\`${waitlistCount}\` channels`, inline: true },
        { name: '🎙️ Voice Channels Set', value: `\`${voiceCount}\` channels`, inline: true }
      )
      .setColor(COLORS.SUCCESS)
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
