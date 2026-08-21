import { StringSelectMenuInteraction } from 'discord.js';
import { Mode } from '../../config/constants';
import prisma from '../../database/prisma';
import { giveWaitlistRole } from '../../services/roleService';
import { MODES } from '../../config/constants';

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days

// ─── Waitlist role select (registration panel Step 2) ────────────────────────
export async function handleWaitlistRoleSelect(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });

  const mode = interaction.values[0] as Mode;
  const modeName = MODES[mode];

  if (!modeName) {
    await interaction.editReply({ content: '❌ Unknown gamemode selected.' });
    return;
  }

  // Must be registered first
  const player = await prisma.player.findUnique({ where: { discordId: interaction.user.id } });
  if (!player) {
    await interaction.editReply({
      content: '❌ You must register first! Click **Register / Update Profile** to set up your account before claiming a waitlist role.',
    });
    return;
  }

  // Check cooldown stored in player metadata
  const meta = (player.waitlistRoleCooldowns as Record<string, string>) ?? {};
  const lastClaimed = meta[mode] ? new Date(meta[mode]).getTime() : 0;
  const now = Date.now();
  const remaining = COOLDOWN_MS - (now - lastClaimed);

  if (remaining > 0) {
    const days = Math.floor(remaining / (1_000 * 60 * 60 * 24));
    const hours = Math.floor((remaining % (1_000 * 60 * 60 * 24)) / (1_000 * 60 * 60));
    const mins = Math.floor((remaining % (1_000 * 60 * 60)) / (1_000 * 60));
    await interaction.editReply({
      content: `⏳ You already claimed the **${modeName}** waitlist role recently.\nCooldown: **${days}d ${hours}h ${mins}m** remaining.`,
    });
    return;
  }

  // Give the waitlist role
  try {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    await giveWaitlistRole(member, mode);
  } catch (e) {
    console.error('Error giving waitlist role:', e);
    await interaction.editReply({ content: '❌ Failed to assign the role. Make sure the bot has permission.' });
    return;
  }

  // Store cooldown timestamp
  meta[mode] = new Date().toISOString();
  await prisma.player.update({
    where: { discordId: interaction.user.id },
    data: { waitlistRoleCooldowns: meta },
  });

  await interaction.editReply({
    content: `✅ You've been given the **${modeName}** waitlist role!\nYou can claim this role again in **7 days**.`,
  });
}
