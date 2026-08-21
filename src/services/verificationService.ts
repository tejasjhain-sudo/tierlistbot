import crypto from 'crypto';
import { Client, Guild, GuildMember, EmbedBuilder } from 'discord.js';
import { VerificationStatus, Mode, Region } from '../config/constants';
import prisma from '../database/prisma';
import { giveRegisteredRole } from './roleService';
import { logToChannel } from '../utils/logger';
import { COLORS } from '../config/constants';

// ─── Generate cryptographically secure verification token (e.g. RM-7X29-KD8P) ───
export function generateVerificationToken(): string {
  const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `RM-${part1}-${part2}`;
}

// ─── Create a new verification session (10 min expiry) ──────────────────────────
export async function createVerificationSession(
  discordId: string,
  minecraftUsername?: string
): Promise<{
  token: string;
  expiresAt: Date;
}> {
  // Expire any existing PENDING sessions for this user
  await prisma.verificationSession.updateMany({
    where: { discordId, status: VerificationStatus.PENDING },
    data: { status: VerificationStatus.CANCELLED },
  });

  const token = generateVerificationToken();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

  await prisma.verificationSession.create({
    data: {
      discordId,
      token,
      expiresAt,
      status: VerificationStatus.PENDING,
      minecraftUsername: minecraftUsername ? minecraftUsername.toLowerCase() : null,
    },
  });

  return { token, expiresAt };
}

// Active Discord interaction responses awaiting in-game completion
export const pendingInteractions = new Map<string, any>();

// ─── Complete Verification from Minecraft Plugin / API ─────────────────────────
export async function completeVerification(
  token: string,
  minecraftUuid: string,
  minecraftUsername: string,
  client?: Client
): Promise<{
  success: boolean;
  message: string;
  discordId?: string;
  player?: any;
}> {
  const session = await prisma.verificationSession.findUnique({
    where: { token },
  });

  if (!session) {
    return { success: false, message: 'Invalid verification token.' };
  }

  if (session.status !== VerificationStatus.PENDING) {
    return { success: false, message: `Token has already been ${session.status.toLowerCase()}.` };
  }

  if (new Date() > new Date(session.expiresAt)) {
    await prisma.verificationSession.update({
      where: { id: session.id },
      data: { status: VerificationStatus.EXPIRED },
    });
    return { success: false, message: 'Verification token has expired. Please generate a new one with /verify in Discord.' };
  }

  // Check if this Minecraft UUID is already linked to another Discord account
  const existingMc = await prisma.player.findFirst({
    where: { minecraftUuid, NOT: { discordId: session.discordId } },
  });
  if (existingMc) {
    return { success: false, message: `Minecraft UUID is already linked to another Discord account (<@${existingMc.discordId}>).` };
  }

  // Upsert Player record with permanent minecraftUuid identity
  const player = await prisma.player.upsert({
    where: { discordId: session.discordId },
    update: {
      minecraftUsername,
      minecraftUsernameLower: minecraftUsername.toLowerCase(),
      minecraftUuid,
      updatedAt: new Date(),
      lastIgnUpdateAt: new Date(),
    },
    create: {
      discordId: session.discordId,
      minecraftUsername,
      minecraftUsernameLower: minecraftUsername.toLowerCase(),
      minecraftUuid,
      region: Region.NA,
      preferredMode: Mode.sword,
    },
  });

  // Update session status
  await prisma.verificationSession.update({
    where: { id: session.id },
    data: {
      status: VerificationStatus.VERIFIED,
      verifiedAt: new Date(),
      minecraftUuid,
      minecraftUsername,
    },
  });

  // Live update Discord interaction response if pending
  const pendingInteraction = pendingInteractions.get(token);
  if (pendingInteraction) {
    try {
      const { EmbedBuilder } = require('discord.js');
      const embed = new EmbedBuilder()
        .setTitle('✅ Account Verification Complete!')
        .setDescription(
          `Your Discord account has been linked to your Minecraft account!\n\n` +
          `🎮 **Minecraft IGN:** \`${minecraftUsername}\`\n` +
          `🆔 **Minecraft UUID:** \`${minecraftUuid}\`\n` +
          `**Status:** ✅ **VERIFIED**\n\n` +
          `You have been granted the **Verified** role! You can now click **Enter Waitlist**!`
        )
        .setColor('#00FF00')
        .setTimestamp();

      await pendingInteraction.editReply({ embeds: [embed] }).catch(() => {});
      pendingInteractions.delete(token);
    } catch (e) {
      console.error('Failed to live-update verification interaction:', e);
    }
  }

  // Assign Verified / Registered role in connected Discord guilds if client is available
  if (client) {
    for (const [, guild] of client.guilds.cache) {
      try {
        const member = await guild.members.fetch(session.discordId).catch(() => null);
        if (member) {
          // Check for Verified or Registered role
          let verifiedRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'verified' || r.name.toLowerCase() === 'verified player');
          let registeredRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'registered');

          if (verifiedRole) {
            await member.roles.add(verifiedRole).catch(() => {});
          }
          if (registeredRole) {
            await member.roles.add(registeredRole).catch(() => {});
          }
          if (!verifiedRole && !registeredRole) {
            await giveRegisteredRole(member).catch(() => {});
          }

          // Send a log to the server's log channel
          const logEmbed = new EmbedBuilder()
            .setTitle('✅ Player Verified (Minecraft)')
            .setDescription(`**User:** <@${member.id}> (${member.user.tag})\n**IGN:** \`${minecraftUsername}\`\n**UUID:** \`${minecraftUuid}\``)
            .setColor(COLORS.SUCCESS)
            .setTimestamp();
          
          await logToChannel(client, guild.id, logEmbed);
        }
      } catch (err) {
        console.error(`Failed to give verified role in guild ${guild.name}:`, err);
      }
    }

    // Send DM notification to the user
    try {
      const user = await client.users.fetch(session.discordId).catch(() => null);
      if (user) {
        const { EmbedBuilder } = require('discord.js');
        const dmEmbed = new EmbedBuilder()
          .setTitle('✅ Account Verification Complete!')
          .setDescription(
            `Your Discord account has been successfully linked to your Minecraft account!\n\n` +
            `🎮 **Minecraft IGN:** \`${minecraftUsername}\`\n` +
            `🆔 **Minecraft UUID:** \`${minecraftUuid}\`\n\n` +
            `You have been granted the **Verified** role. You can now click **Enter Waitlist** on the evaluation testing panel!`
          )
          .setColor('#00FF00')
          .setTimestamp();

        await user.send({ embeds: [dmEmbed] }).catch(() => {});
      }
    } catch (dmErr) {
      console.error('Failed to send verification DM:', dmErr);
    }
  }

  return {
    success: true,
    message: `Successfully verified! Linked Discord <@${session.discordId}> to Minecraft IGN: ${minecraftUsername}`,
    discordId: session.discordId,
    player,
  };
}

// ─── Unlink Account ────────────────────────────────────────────────────────────
export async function unlinkAccount(
  discordId: string,
  guild?: Guild
): Promise<{ success: boolean; message: string; minecraftUsername?: string }> {
  const player = await prisma.player.findUnique({ where: { discordId } });
  if (!player) {
    return { success: false, message: 'That Discord account is not linked to any Minecraft profile.' };
  }

  const mcUsername = player.minecraftUsername;

  // Remove queue entries
  await prisma.queueEntry.deleteMany({ where: { playerId: player.id } });

  // Reset verification sessions
  await prisma.verificationSession.updateMany({
    where: { discordId, status: VerificationStatus.VERIFIED },
    data: { status: VerificationStatus.CANCELLED },
  });

  // Remove Player DB record (historical TierHistory remains attached by UUID)
  await prisma.player.delete({ where: { discordId } });

  // Remove Verified role if guild provided
  if (guild) {
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (member) {
      const verifiedRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'verified' || r.name.toLowerCase() === 'verified player' || r.name.toLowerCase() === 'registered');
      if (verifiedRole && member.roles.cache.has(verifiedRole.id)) {
        await member.roles.remove(verifiedRole).catch(() => {});
      }
    }
  }

  return {
    success: true,
    message: `Successfully unlinked Discord <@${discordId}> from Minecraft IGN: \`${mcUsername}\`.`,
    minecraftUsername: mcUsername,
  };
}
