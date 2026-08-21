import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  AttachmentBuilder,
  EmbedBuilder,
} from 'discord.js';
import prisma from '../../database/prisma';
import { COLORS } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('check-suspicious-list')
    .setDescription('[Admin] Cross-check a list of external Discord IDs/usernames against this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addAttachmentOption(opt =>
      opt.setName('file').setDescription('The .txt file containing the IDs or usernames (one per line)').setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: 'Must be run in a server.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    const attachment = interaction.options.getAttachment('file', true);
    
    // Fetch file content
    const response = await fetch(attachment.url).catch(() => null);
    if (!response || !response.ok) {
      return interaction.editReply({ content: '❌ Failed to read the uploaded file.' });
    }

    const text = await response.text();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length === 0) {
      return interaction.editReply({ content: '❌ The uploaded file is empty.' });
    }

    await interaction.editReply({ content: `⏳ Fetching server members and cross-checking \`${lines.length}\` lines...` });

    const currentMembers = await interaction.guild.members.fetch().catch(() => null);
    if (!currentMembers) {
      return interaction.editReply({ content: '❌ Failed to fetch server members.' });
    }

    const matchedMembers = new Map<string, any>();

    for (const line of lines) {
      const isId = /^\d{17,21}$/.test(line);
      if (isId) {
        const member = currentMembers.get(line);
        if (member && !member.user.bot) {
          matchedMembers.set(member.id, member);
        }
      } else {
        const cleanLine = line.toLowerCase();
        const member = Array.from(currentMembers.values()).find(m => 
          !m.user.bot && (
            m.user.username.toLowerCase() === cleanLine ||
            m.user.tag.toLowerCase() === cleanLine
          )
        );
        if (member) {
          matchedMembers.set(member.id, member);
        }
      }
    }

    const matchedList = Array.from(matchedMembers.values());

    if (matchedList.length === 0) {
      return interaction.editReply({
        content: `📊 Checked \`${lines.length}\` inputs. **0 matching members** were found in this server.`
      });
    }

    const listContent = matchedList.map(m => `${m.user.tag} (${m.user.id})`).join('\n');

    const embed = new EmbedBuilder()
      .setTitle('🛡️ Suspicious Members Cross-Check Report')
      .setDescription(
        `Checked \`${lines.length}\` lines from the uploaded file against this server:\n\n` +
        `🎯 **Matching Members Found:** \`${matchedList.length}\` (excluding bots)`
      )
      .setColor(COLORS.PRIMARY)
      .setTimestamp();

    if (matchedList.length <= 40) {
      embed.addFields({
        name: 'Matched Members List',
        value: matchedList.map(m => `<@${m.id}>`).join(', ')
      });
      return interaction.editReply({ embeds: [embed] });
    } else {
      embed.addFields({
        name: 'First 30 Matched Members',
        value: matchedList.slice(0, 30).map(m => `<@${m.id}>`).join(', ') + '... *(full list attached)*'
      });

      const buffer = Buffer.from(listContent, 'utf-8');
      const file = new AttachmentBuilder(buffer, { name: 'matched_members.txt' });

      return interaction.editReply({ embeds: [embed], files: [file] });
    }
  },
};
