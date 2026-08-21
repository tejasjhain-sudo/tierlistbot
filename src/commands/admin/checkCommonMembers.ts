import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  AttachmentBuilder,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import prisma from '../../database/prisma';
import { COLORS } from '../../config/constants';

function extractInviteCode(link: string): string {
  const match = link.match(/(?:https?:\/\/)?(?:www\.)?(?:discord\.gg\/|discord\.com\/invite\/)([a-zA-Z0-9\-]+)/);
  return match ? match[1] : link.trim();
}

export default {
  data: new SlashCommandBuilder()
    .setName('check-common-members')
    .setDescription('[Admin] Find which members in this server are also in another server via an invite link.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName('invite-link').setDescription('Invite link or code of the other server').setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: 'Must be run in a server.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    const link = interaction.options.getString('invite-link', true);
    const code = extractInviteCode(link);

    let invite;
    try {
      invite = await interaction.client.fetchInvite(code);
    } catch (err) {
      return interaction.editReply({ content: '❌ Invalid or expired Discord invite link/code.' });
    }

    if (!invite.guild) {
      return interaction.editReply({ content: '❌ The invite link must lead to a server, not a group chat.' });
    }

    const targetGuildId = invite.guild.id;
    const targetGuildName = invite.guild.name;

    if (targetGuildId === interaction.guild.id) {
      return interaction.editReply({ content: '❌ The invite link points to this server! Please supply an invite link to a different server.' });
    }

    const targetGuild = interaction.client.guilds.cache.get(targetGuildId);
    if (!targetGuild) {
      const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${interaction.client.user.id}&permissions=8&scope=bot%20applications.commands`;
      return interaction.editReply({
        content: `❌ **I am not in that server!**\n\nI must be added to the server **${targetGuildName}** first to fetch and compare its members. You can invite me using the link below:\n🔗 [**Invite Bot to ${targetGuildName}**](${inviteUrl})\n\nOnce added, run this command again!`
      });
    }

    await interaction.editReply({ content: '⏳ Fetching members from both servers...' });

    const currentMembers = await interaction.guild.members.fetch().catch(() => null);
    const otherMembers = await targetGuild.members.fetch().catch(() => null);

    if (!currentMembers || !otherMembers) {
      return interaction.editReply({ content: '❌ Failed to fetch members. Please ensure the bot has Server Members Intent enabled.' });
    }

    const common = Array.from(currentMembers.values()).filter(m => 
      otherMembers.has(m.id) && !m.user.bot
    );

    if (common.length === 0) {
      return interaction.editReply({
        content: `📊 Checked! There are **0 common members** between **${interaction.guild.name}** and **${targetGuildName}**.`
      });
    }

    const listContent = common.map(m => `${m.user.tag} (${m.user.id})`).join('\n');

    const embed = new EmbedBuilder()
      .setTitle('📊 Common Members Report')
      .setDescription(
        `Comparing members between:\n` +
        `• **Source Server:** \`${interaction.guild.name}\`\n` +
        `• **Target/Invite Server:** \`${targetGuildName}\`\n\n` +
        `👥 **Total Common Members:** \`${common.length}\` (excluding bots)`
      )
      .setColor(COLORS.PRIMARY)
      .setTimestamp();

    if (common.length <= 40) {
      embed.addFields({
        name: 'Common Members List',
        value: common.map(m => `<@${m.id}>`).join(', ')
      });
      return interaction.editReply({ embeds: [embed] });
    } else {
      embed.addFields({
        name: 'First 30 Common Members',
        value: common.slice(0, 30).map(m => `<@${m.id}>`).join(', ') + '... *(full list attached)*'
      });

      const buffer = Buffer.from(listContent, 'utf-8');
      const file = new AttachmentBuilder(buffer, { name: 'common_members.txt' });

      return interaction.editReply({ embeds: [embed], files: [file] });
    }
  },
};
