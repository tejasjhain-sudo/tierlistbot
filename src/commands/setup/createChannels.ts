import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  CategoryChannel,
  TextChannel,
  VoiceChannel,
} from 'discord.js';
import { COLORS } from '../../config/constants';

interface ChannelDef {
  name: string;
  type?: ChannelType;
  userLimit?: number;
}

interface CategoryDef {
  category: string;
  channels: ChannelDef[];
}

const TEMPLATE_STRUCTURE: CategoryDef[] = [
  {
    category: '📊SERVER STATS📊',
    channels: [
      { name: '👋・welcome' },
      { name: '✨・booster-perks' },
      { name: '🎉・boosters' },
      { name: '👥・members', type: ChannelType.GuildVoice },
    ],
  },
  {
    category: '💻 Important',
    channels: [
      { name: '📖・rules' },
      { name: '📢・announcement' },
      { name: '🔔・community-announcements' },
      { name: '📰・updates' },
      { name: '🥇・events' },
      { name: '🎊・advertisements' },
      { name: '🧩・reaction-roles' },
      { name: '📜・website' },
      { name: '📊・my-channels' },
      { name: '💥・fusion-network-as' },
      { name: '🌊・ocean-scanner' },
      { name: '👑・clout-universe' },
      { name: '📄・papernodes' },
      { name: '👑・championsmc' },
    ],
  },
  {
    category: '📥 Requests',
    channels: [
      { name: '📩・request-test' },
      { name: '💳・request-support' },
      { name: '📝・applications' },
      { name: '💵・buy-ad' },
      { name: '📩・appeal-hub' },
      { name: '🚨・migration' },
    ],
  },
  {
    category: '📄 Tierlist',
    channels: [
      { name: '📌・testing-rules' },
      { name: '💫・staff-movements' },
      { name: '❌・punishments' },
      { name: '🏆・high-results' },
      { name: '🏆・results' },
      { name: '🔻・retirement-demotions' },
      { name: '✅・verified-servers' },
      { name: '📜・rubric' },
    ],
  },
  {
    category: '🌴COMMUNITY',
    channels: [
      { name: '💬・chit-chat' },
      { name: '📷・media' },
      { name: '🤖・commands' },
      { name: '📜・suggestions' },
      { name: '📋・forums' },
      { name: '❓・questions' },
    ],
  },
  {
    category: 'Polls 📊',
    channels: [
      { name: '📊・poll-of-the-day' },
      { name: '💬・poll-discussion' },
    ],
  },
  {
    category: 'Voice Channels',
    channels: [
      { name: '🎭 Stage', type: ChannelType.GuildVoice },
      { name: '🎙️ VC-1', type: ChannelType.GuildVoice },
      { name: '🎙️ Duos', type: ChannelType.GuildVoice, userLimit: 2 },
    ],
  },
];

export default {
  data: new SlashCommandBuilder()
    .setName('setup-channels')
    .setDescription('Automatically create all server categories and channels from the template.')
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
    let categoriesCreated = 0;
    let channelsCreated = 0;
    let channelsSkipped = 0;

    for (const group of TEMPLATE_STRUCTURE) {
      // Find or create Category
      let category = guild.channels.cache.find(
        c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === group.category.toLowerCase()
      ) as CategoryChannel | undefined;

      if (!category) {
        try {
          category = (await guild.channels.create({
            name: group.category,
            type: ChannelType.GuildCategory,
            reason: '/setup-channels template creation',
          })) as CategoryChannel;
          categoriesCreated++;
        } catch (err) {
          console.error(`Failed to create category ${group.category}:`, err);
          continue;
        }
      }

      // Find or create channels inside category
      for (const chDef of group.channels) {
        const targetType = chDef.type ?? ChannelType.GuildText;
        const existing = guild.channels.cache.find(
          c => c.parentId === category!.id && c.name.toLowerCase() === chDef.name.toLowerCase()
        );

        if (existing) {
          channelsSkipped++;
          continue;
        }

        try {
          await guild.channels.create({
            name: chDef.name,
            type: targetType as any,
            parent: category.id,
            userLimit: chDef.userLimit,
            reason: '/setup-channels template creation',
          });
          channelsCreated++;
          // Small delay to prevent hitting Discord API rate limits
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (err) {
          console.error(`Failed to create channel ${chDef.name}:`, err);
        }
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Server Template Channels Created!')
      .setDescription(`Successfully created template categories and channels for **${guild.name}**!`)
      .addFields(
        { name: '📁 Categories Created', value: `\`${categoriesCreated}\``, inline: true },
        { name: '💬 Channels Created', value: `\`${channelsCreated}\``, inline: true },
        { name: '⏩ Existing Channels Skipped', value: `\`${channelsSkipped}\``, inline: true }
      )
      .setColor(COLORS.SUCCESS)
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
