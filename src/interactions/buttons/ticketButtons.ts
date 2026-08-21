import {
  ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
} from 'discord.js';
import { SessionStatus, Tier } from '../../config/constants';
import prisma from '../../database/prisma';
import { skipPlayer, completeTest } from '../../services/testerService';
import { COLORS, TIERS } from '../../config/constants';

// ─── Complete Test button ─────────────────────────────────────────────────────
export async function handleCompleteTest(interaction: ButtonInteraction, sessionId: string): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId(`complete_test_modal_${sessionId}`)
    .setTitle('Complete Tier Test');

  const tierInput = new TextInputBuilder()
    .setCustomId('earned_tier')
    .setLabel('Earned Tier (HT1, LT1, HT2 … Unranked)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('e.g. HT2');

  const notesInput = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Notes (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  const evidenceInput = new TextInputBuilder()
    .setCustomId('evidence_url')
    .setLabel('Evidence URL (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(tierInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(evidenceInput),
  );

  await interaction.showModal(modal);
}

// ─── Skip Player button ───────────────────────────────────────────────────────
export async function handleSkipButton(interaction: ButtonInteraction, sessionId: string): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  
  const session = await prisma.testSession.findUnique({ where: { id: sessionId } });
  if (!session || session.status !== SessionStatus.ACTIVE) {
    await interaction.editReply({ content: '❌ Session not found or already closed.' });
    return;
  }

  // Check permissions
  const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild!.id } });
  const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};
  const member = interaction.guild?.members.cache.get(interaction.user.id);
  const isAuthorized = interaction.user.id === session.testerDiscordId
    || member?.roles.cache.has(roleIds.tierManager)
    || member?.roles.cache.has(roleIds.tierAdmin);

  if (!isAuthorized) {
    await interaction.editReply({ content: '❌ Only the assigned tester or staff can skip.' });
    return;
  }

  const row = new ActionRowBuilder<any>().addComponents(
    { type: 2, style: 1, label: '⬆️ Return to Front', custom_id: `skip_front_${sessionId}` },
    { type: 2, style: 2, label: '⬇️ Return to Back', custom_id: `skip_back_${sessionId}` },
    { type: 2, style: 4, label: '🗑️ Remove Completely', custom_id: `skip_remove_${sessionId}` },
  );

  const embed = new EmbedBuilder()
    .setTitle('⏭️ Skip Player')
    .setDescription('Choose what happens to the player after skipping:')
    .setColor(COLORS.WARNING);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ─── Skip action buttons ──────────────────────────────────────────────────────
export async function handleSkipAction(
  interaction: ButtonInteraction,
  sessionId: string,
  action: 'front' | 'back' | 'remove'
): Promise<void> {
  if (!interaction.guild) return;
  
  await interaction.deferReply({ ephemeral: true });

  const session = await prisma.testSession.findUnique({ where: { id: sessionId } });
  const skipReason = session?.skipReason ?? null;

  const result = await skipPlayer(interaction.guild, sessionId, skipReason, action, interaction.user.id);

  await interaction.editReply({
    content: result.success ? `✅ ${result.message}` : `❌ ${result.message}`,
  });
}

// ─── Cancel Session button ────────────────────────────────────────────────────
export async function handleCancelSession(interaction: ButtonInteraction, sessionId: string): Promise<void> {
  if (!interaction.guild) return;

  await interaction.deferReply({ ephemeral: true });

  const session = await prisma.testSession.findUnique({ where: { id: sessionId }, include: { player: true } });
  if (!session || session.status !== SessionStatus.ACTIVE) {
    await interaction.editReply({ content: '❌ Session not found or already closed.' });
    return;
  }

  const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
  const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};
  const member = interaction.guild.members.cache.get(interaction.user.id);
  const isAuthorized = interaction.user.id === session.testerDiscordId
    || member?.roles.cache.has(roleIds.tierManager)
    || member?.roles.cache.has(roleIds.tierAdmin);

  if (!isAuthorized) {
    await interaction.editReply({ content: '❌ Not authorized.' });
    return;
  }

  await prisma.testSession.update({
    where: { id: sessionId },
    data: { status: SessionStatus.CANCELLED, cancelledAt: new Date() },
  });

  // Restore the player's waitlist role
  try {
    const playerMember = await interaction.guild.members.fetch(session.player.discordId);
    const waitlistRoleId = roleIds.waitlists?.[session.mode];
    if (waitlistRoleId) await playerMember.roles.add(waitlistRoleId);
  } catch {}

  await interaction.editReply({ content: '✅ Session cancelled. Player returned to queue access.' });
}

// ─── Close Ticket button ──────────────────────────────────────────────────────
export async function handleCloseTicket(interaction: ButtonInteraction, sessionId: string): Promise<void> {
  if (!interaction.guild) return;

  await interaction.deferReply({ ephemeral: true });

  const session = await prisma.testSession.findUnique({ where: { id: sessionId } });
  if (session && session.status === SessionStatus.ACTIVE) {
    await interaction.editReply({ content: '⚠️ Complete or cancel the test before closing the ticket.' });
    return;
  }

  await interaction.editReply({ content: '🔒 Closing ticket in 10 seconds...' });

  setTimeout(async () => {
    try {
      await interaction.channel?.delete();
    } catch {}
  }, 10_000);
}
