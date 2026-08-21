import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import { SessionStatus } from '../../config/constants';
import prisma from '../../database/prisma';
import { COLORS } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('session-force-close')
    .setDescription('Forcefully cancel an active test session for a stuck user.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(opt => 
      opt.setName('user').setDescription('The user (tester or player) who is stuck in an active session').setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: 'Must be used in a server.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser('user', true);

    // Find any ACTIVE session where this user is either the player or the tester
    // First find if they are registered as a player
    const player = await prisma.player.findUnique({ where: { discordId: targetUser.id } });
    
    const activeSessions = await prisma.testSession.findMany({
      where: {
        status: SessionStatus.ACTIVE,
        OR: [
          { testerDiscordId: targetUser.id },
          ...(player ? [{ playerId: player.id }] : [])
        ]
      }
    });

    if (activeSessions.length === 0) {
      return interaction.editReply({ content: `❌ <@${targetUser.id}> does not have any active test sessions.` });
    }

    let closedCount = 0;
    for (const session of activeSessions) {
      await prisma.testSession.update({
        where: { id: session.id },
        data: {
          status: SessionStatus.CANCELLED,
          cancelledAt: new Date(),
          notes: 'Forcefully cancelled by staff.'
        }
      });
      closedCount++;
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Sessions Force Closed')
      .setDescription(`Successfully forcefully closed ${closedCount} active session(s) for <@${targetUser.id}>.\nThey should now be able to use \`/next\` or join queues again.`)
      .setColor(COLORS.SUCCESS)
      .setTimestamp();
      
    return interaction.editReply({ embeds: [embed] });
  },
};
