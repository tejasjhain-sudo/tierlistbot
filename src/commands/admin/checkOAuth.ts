import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import prisma from '../../database/prisma';
import { COLORS } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('check-oauth')
    .setDescription('[Admin] Check how many players have completed Account/OAuth Verification.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Must be used inside a server.', ephemeral: true });
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) && interaction.guild.ownerId !== interaction.user.id) {
      return interaction.reply({ content: '❌ Only Server Administrators can run this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: false });
    const guild = interaction.guild;

    // 1. Safe Member Count from Guild
    const totalMembers = guild.memberCount || guild.members.cache.size;

    // 2. Count members with Authorised / Verified role from cache
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) || {};
    const authorisedRoleId = roleIds.authorised || roleIds.verified;
    const authorisedRole = authorisedRoleId ? guild.roles.cache.get(authorisedRoleId) : guild.roles.cache.find(r => r.name.toLowerCase() === 'authorised' || r.name.toLowerCase() === 'verified');

    const verifiedRoleCount = authorisedRole ? authorisedRole.members.size : 0;

    // 3. Database counts
    const totalWithOAuthToken = await prisma.player.count({
      where: { discordAccessToken: { not: null } }
    });

    const totalRegisteredMC = await prisma.player.count({
      where: {
        AND: [
          { minecraftUsername: { not: '' } },
          { NOT: { minecraftUsername: { startsWith: 'User_' } } }
        ]
      }
    });

    // 4. Get list of recent verified players
    const recentVerified = await prisma.player.findMany({
      where: { discordAccessToken: { not: null } },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });

    const displayVerifiedCount = Math.max(verifiedRoleCount, totalWithOAuthToken);
    const percentage = totalMembers > 0 ? Math.round((displayVerifiedCount / totalMembers) * 100) : 0;

    let recentList = '';
    if (recentVerified.length === 0) {
      recentList = '_No members have verified via the verification button yet._';
    } else {
      recentList = recentVerified
        .map((p, idx) => `${idx + 1}. <@${p.discordId}> (\`${p.minecraftUsername}\`) • <t:${Math.floor(new Date(p.updatedAt).getTime() / 1000)}:R>`)
        .join('\n');
    }

    const embed = new EmbedBuilder()
      .setTitle('🛡️ Account & OAuth Verification Statistics')
      .setDescription(
        `Real-time status of server members who completed **Verification & Backup** vs **Minecraft Registration**:\n\n` +
        `📊 **Total Server Members:** \`${totalMembers}\`\n` +
        `✅ **Verified / Authorised Members:** \`${displayVerifiedCount}\` (${percentage}%)\n` +
        `🔒 **Verified in Database/Supabase:** \`${totalWithOAuthToken}\`\n` +
        `🎮 **Registered Minecraft Accounts:** \`${totalRegisteredMC}\`\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📋 **Recently Verified Players:**\n${recentList}`
      )
      .setColor(COLORS.PRIMARY)
      .setFooter({ text: 'Arix Verification Tracking' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
