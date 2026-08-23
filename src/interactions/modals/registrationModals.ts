import {
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  EmbedBuilder,
} from 'discord.js';
import { Mode, Region } from '../../config/constants';
import prisma from '../../database/prisma';
import { fetchMinecraftProfile, isValidMinecraftUsername } from '../../services/minecraftService';
import { giveRegisteredRole, swapWaitlistRole } from '../../services/roleService';
import { joinQueue } from '../../services/queueService';
import { sendOrUpdateWaitlistPanel } from '../../services/panelService';
import { completeTest } from '../../services/testerService';
import { COLORS, MODES, REGIONS, TIERS, Tier } from '../../config/constants';

// ─── Register modal submit ────────────────────────────────────────────────────
export async function handleRegisterModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;

  await interaction.deferReply({ ephemeral: true });

  const rawUsername = interaction.fields.getTextInputValue('minecraft_username').trim();

  if (!isValidMinecraftUsername(rawUsername)) {
    await interaction.editReply({
      content: '❌ Invalid Minecraft username. It must be 3–16 characters and only contain letters, numbers, and underscores.',
    });
    return;
  }

  // Check if blacklisted
  const blacklisted = await prisma.blacklist.findUnique({
    where: { guildId_discordId: { guildId: interaction.guild.id, discordId: interaction.user.id } }
  });
  if (blacklisted) {
    await interaction.editReply({
      content: `❌ You are blacklisted from registering. Reason: ${blacklisted.reason}`,
    });
    return;
  }

  // Check if Discord user already registered with a real Minecraft account
  const existingByDiscord = await prisma.player.findUnique({ where: { discordId: interaction.user.id } });
  const hasLinkedMinecraft = existingByDiscord && existingByDiscord.minecraftUuid && !existingByDiscord.minecraftUsername.startsWith('User_');
  if (hasLinkedMinecraft) {
    await interaction.editReply({
      content: `❌ You are already registered as **${existingByDiscord.minecraftUsername}**. Click **⚙️ Update Account** if you wish to change your details.`,
    });
    return;
  }

  // Check if username taken by another Discord user
  const existingByMc = await prisma.player.findUnique({ where: { minecraftUsernameLower: rawUsername.toLowerCase() } });
  if (existingByMc && existingByMc.discordId !== interaction.user.id) {
    await interaction.editReply({
      content: `❌ Minecraft username \`${rawUsername}\` is already registered by another user.`,
    });
    return;
  }

  // Build region select
  const regionSelect = new StringSelectMenuBuilder()
    .setCustomId(`register_region_${encodeURIComponent(rawUsername)}`)
    .setPlaceholder('Select your region')
    .addOptions(
      Object.entries(REGIONS).map(([key, label]) =>
        new StringSelectMenuOptionBuilder().setLabel(`${key} — ${label}`).setValue(key)
      )
    );

  const embed = new EmbedBuilder()
    .setTitle('📋 Registration — Step 2: Select Region')
    .setDescription(`Username: \`${rawUsername}\`\n\nSelect the region you play from:`)
    .setColor(COLORS.PRIMARY);

  await interaction.editReply({
    embeds: [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(regionSelect)],
  });
}

// ─── Update profile modal submit ──────────────────────────────────────────────
export async function handleUpdateProfileModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;

  await interaction.deferReply({ ephemeral: true });

  const rawUsername = interaction.fields.getTextInputValue('minecraft_username').trim();

  const player = await prisma.player.findUnique({ where: { discordId: interaction.user.id } });
  if (!player) {
    await interaction.editReply({ content: '❌ You are not registered.' });
    return;
  }

  let finalUsername = player.minecraftUsername;
  let finalUuid = player.minecraftUuid;

  if (rawUsername && rawUsername !== player.minecraftUsername) {
    if (!isValidMinecraftUsername(rawUsername)) {
      await interaction.editReply({ content: '❌ Invalid Minecraft username format.' });
      return;
    }

    const taken = await prisma.player.findFirst({
      where: { minecraftUsernameLower: rawUsername.toLowerCase(), NOT: { discordId: interaction.user.id } },
    });
    if (taken) {
      await interaction.editReply({ content: `❌ Username \`${rawUsername}\` is already registered.` });
      return;
    }

    const profile = await fetchMinecraftProfile(rawUsername);
    finalUsername = profile?.name ?? rawUsername;
    finalUuid = profile?.id ?? null;
  }

  // Show region + mode update selects
  const regionSelect = new StringSelectMenuBuilder()
    .setCustomId(`update_region_${encodeURIComponent(finalUsername)}`)
    .setPlaceholder(`Current region: ${player.region}`)
    .addOptions(
      Object.entries(REGIONS).map(([key, label]) =>
        new StringSelectMenuOptionBuilder().setLabel(`${key} — ${label}`).setValue(key)
      )
    );

  await interaction.editReply({
    content: `Updating profile for \`${finalUsername}\`. Select your new region:`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(regionSelect)],
  });
}

// ─── Complete test modal submit ───────────────────────────────────────────────
export async function handleCompleteTestModal(interaction: ModalSubmitInteraction, sessionId: string): Promise<void> {
  if (!interaction.guild) return;

  await interaction.deferReply({ ephemeral: true });

  const earnedTierRaw = interaction.fields.getTextInputValue('earned_tier').trim();
  const notes = interaction.fields.getTextInputValue('notes').trim() || null;
  const evidenceUrl = interaction.fields.getTextInputValue('evidence_url').trim() || null;

  if (!TIERS.includes(earnedTierRaw as Tier)) {
    await interaction.editReply({
      content: `❌ Invalid tier \`${earnedTierRaw}\`. Valid values: ${TIERS.join(', ')}`,
    });
    return;
  }

  const result = await completeTest(
    interaction.guild,
    sessionId,
    earnedTierRaw as Tier,
    notes,
    evidenceUrl,
    interaction.user.id
  );

  await interaction.editReply({ content: result.success ? `✅ ${result.message}` : `❌ ${result.message}` });
}

// ─── Verify Account Modal Submit ──────────────────────────────────────────────
export async function handleVerifyAccountModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const rawUsername = interaction.fields.getTextInputValue('minecraft_username').trim();

  if (!isValidMinecraftUsername(rawUsername)) {
    await interaction.editReply({ content: '❌ Invalid Minecraft username format.' });
    return;
  }

  // Ping the MC server to see if it's online
  let isOnline = false;
  const verifyServerIP = (process.env.MINECRAFT_VERIFY_SERVER || 'verify.rearmc.fun:2003').split(':')[0];
  const verifyServerPort = parseInt((process.env.MINECRAFT_VERIFY_SERVER || 'verify.rearmc.fun:2003').split(':')[1] || '25565', 10);
  
  isOnline = await new Promise((resolve) => {
    const util = require('minecraft-server-util');
    util.status(verifyServerIP, verifyServerPort, { timeout: 2000 })
      .then(() => resolve(true))
      .catch(() => resolve(false));
  });

  if (!isOnline) {
    const { fetchMinecraftProfile } = require('../../services/minecraftService');
    const profile = await fetchMinecraftProfile(rawUsername);
    const uuid = profile?.id ?? 'offline-uuid-' + Date.now();
    const finalUsername = profile?.name ?? rawUsername;
    
    await prisma.player.upsert({
      where: { discordId: interaction.user.id },
      create: {
        discordId: interaction.user.id,
        minecraftUsername: finalUsername,
        minecraftUsernameLower: finalUsername.toLowerCase(),
        minecraftUuid: uuid,
        region: 'NA',
        preferredMode: 'sword',
      },
      update: {
        minecraftUsername: finalUsername,
        minecraftUsernameLower: finalUsername.toLowerCase(),
        minecraftUuid: uuid,
      }
    });
    
    const successEmbed = new EmbedBuilder()
      .setTitle('✅ Verified (Offline Mode)')
      .setDescription(`The Minecraft server is currently offline, so we bypassed in-game verification.\nYour account is now linked to **${finalUsername}**!`)
      .setColor(COLORS.SUCCESS);
    await interaction.editReply({ embeds: [successEmbed] });

    try {
      const { logToChannel } = require('../../utils/logger');
      const logEmbed = new EmbedBuilder()
        .setTitle('👤 New Player Verified (Offline)')
        .setDescription(`<@${interaction.user.id}> has linked their account to **${finalUsername}**.`)
        .setColor(COLORS.SUCCESS)
        .setTimestamp();
      await logToChannel(interaction.client, interaction.guildId, logEmbed);
    } catch (e) { console.error('Logger error:', e); }

    return;
  }

  const { createVerificationSession, pendingInteractions } = require('../../services/verificationService');
  const session = await createVerificationSession(interaction.user.id, rawUsername);
  const verifyServer = process.env.MINECRAFT_VERIFY_SERVER || 'verify.rearmc.fun:2003';

  console.log(`[DEBUG] Sending ONLINE verification embed to user ${interaction.user.id} with token ${session.token}`);

  pendingInteractions.set(session.token, interaction);

  const embed = new EmbedBuilder()
    .setTitle('🔐 Minecraft Account Verification')
    .setDescription(
      `To link your Minecraft account, follow these steps:\n\n` +
      `1️⃣ Join the verification server:\n\`${verifyServer}\`\n\n` +
      `2️⃣ In Minecraft chat, type:\n\`/verify ${session.token}\`\n\n` +
      `**Verification Token:** \`${session.token}\`\n` +
      `**Expected IGN:** \`${rawUsername}\`\n` +
      `**Status:** ⏳ Waiting for connection...\n\n` +
      `⏰ *Verification token expires in 10 minutes.*`
    )
    .setColor(COLORS.PRIMARY);

  await interaction.editReply({ embeds: [embed] });
}

// ─── Update Account Modal Submit ──────────────────────────────────────────────
export async function handleUpdateAccountModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const rawUsername = interaction.fields.getTextInputValue('minecraft_username').trim();

  if (!isValidMinecraftUsername(rawUsername)) {
    await interaction.editReply({ content: '❌ Invalid Minecraft username format.' });
    return;
  }

  // Ping the MC server to see if it's online
  let isOnline = false;
  const verifyServerIP = (process.env.MINECRAFT_VERIFY_SERVER || 'verify.rearmc.fun:2003').split(':')[0];
  const verifyServerPort = parseInt((process.env.MINECRAFT_VERIFY_SERVER || 'verify.rearmc.fun:2003').split(':')[1] || '25565', 10);
  
  isOnline = await new Promise((resolve) => {
    const util = require('minecraft-server-util');
    util.status(verifyServerIP, verifyServerPort, { timeout: 2000 })
      .then(() => resolve(true))
      .catch(() => resolve(false));
  });

  if (!isOnline) {
    const { fetchMinecraftProfile } = require('../../services/minecraftService');
    const profile = await fetchMinecraftProfile(rawUsername);
    const uuid = profile?.id ?? 'offline-uuid-' + Date.now();
    const finalUsername = profile?.name ?? rawUsername;
    
    await prisma.player.update({
      where: { discordId: interaction.user.id },
      data: {
        minecraftUsername: finalUsername,
        minecraftUsernameLower: finalUsername.toLowerCase(),
        minecraftUuid: uuid,
        lastIgnUpdateAt: new Date()
      }
    });
    
    const successEmbed = new EmbedBuilder()
      .setTitle('🔄 Account Updated (Offline Mode)')
      .setDescription(`The Minecraft server is currently offline, so we bypassed in-game verification.\nYour account is now linked to **${finalUsername}**!`)
      .setColor(COLORS.SUCCESS);
    await interaction.editReply({ embeds: [successEmbed] });
    return;
  }

  const { createVerificationSession, pendingInteractions } = require('../../services/verificationService');
  const session = await createVerificationSession(interaction.user.id, rawUsername);
  const verifyServer = process.env.MINECRAFT_VERIFY_SERVER || 'verify.rearmc.fun:2003';

  pendingInteractions.set(`update_${session.token}`, interaction);
  pendingInteractions.set(session.token, interaction);

  const embed = new EmbedBuilder()
    .setTitle('🔄 Update Minecraft Account')
    .setDescription(
      `To update your linked Minecraft account, follow these steps:\n\n` +
      `1️⃣ Join the verification server:\n\`${verifyServer}\`\n\n` +
      `2️⃣ In Minecraft chat, type:\n\`/verify ${session.token}\`\n\n` +
      `**Verification Token:** \`${session.token}\`\n` +
      `**Expected IGN:** \`${rawUsername}\`\n` +
      `**Status:** ⏳ Waiting for connection...\n\n` +
      `⏰ *Token expires in 10 minutes.*`
    )
    .setColor(COLORS.PRIMARY);

  await interaction.editReply({ embeds: [embed] });
}
