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
// ─── Verify Account Modal Submit (Direct & Instant) ───────────────────────────
export async function handleVerifyAccountModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const rawUsername = interaction.fields.getTextInputValue('minecraft_username').trim();

  if (!isValidMinecraftUsername(rawUsername)) {
    await interaction.editReply({ content: '❌ Invalid Minecraft username. It must be 3–16 characters and contain only letters, numbers, and underscores.' });
    return;
  }

  // Check if username taken by another Discord user
  const existingByMc = await prisma.player.findUnique({ where: { minecraftUsernameLower: rawUsername.toLowerCase() } });
  if (existingByMc && existingByMc.discordId !== interaction.user.id) {
    await interaction.editReply({ content: `❌ Minecraft username \`${rawUsername}\` is already linked to another Discord account.` });
    return;
  }

  const { fetchMinecraftProfile, getPlayerHeadUrl } = require('../../services/minecraftService');
  const profile = await fetchMinecraftProfile(rawUsername);
  const uuid = profile?.id ?? null;
  const finalUsername = profile?.name ?? rawUsername;

  const player = await prisma.player.upsert({
    where: { discordId: interaction.user.id },
    create: {
      discordId: interaction.user.id,
      minecraftUsername: finalUsername,
      minecraftUsernameLower: finalUsername.toLowerCase(),
      minecraftUuid: uuid,
      region: 'AS',
      preferredMode: 'sword',
    },
    update: {
      minecraftUsername: finalUsername,
      minecraftUsernameLower: finalUsername.toLowerCase(),
      minecraftUuid: uuid,
      updatedAt: new Date(),
    }
  });

  // Assign Authorised and Registered roles
  if (interaction.guild) {
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const { giveRegisteredRole, giveAuthorisedRole, removeUnauthorisedRole } = require('../../services/roleService');
      await giveAuthorisedRole(member);
      await removeUnauthorisedRole(member);
      await giveRegisteredRole(member);
    } catch (e) {
      console.error('Failed to assign roles on verify account modal:', e);
    }
  }

  const successEmbed = new EmbedBuilder()
    .setTitle('✅ Minecraft Account Linked!')
    .setThumbnail(getPlayerHeadUrl(uuid ?? finalUsername))
    .setDescription(
      `Your Discord account has been successfully linked to **${finalUsername}**!\n\n` +
      `🎮 **Minecraft IGN:** \`${finalUsername}\`\n` +
      `🆔 **UUID:** \`${uuid ?? 'N/A'}\`\n` +
      `🌍 **Region:** \`${player.region}\`\n\n` +
      `You now have full access to testing waitlists and queue channels.`
    )
    .setColor(COLORS.SUCCESS)
    .setTimestamp();

  await interaction.editReply({ embeds: [successEmbed] });

  if (interaction.guild) {
    try {
      const { logToChannel } = require('../../utils/logger');
      const logEmbed = new EmbedBuilder()
        .setTitle('👤 Minecraft Account Linked')
        .setDescription(`<@${interaction.user.id}> linked Minecraft IGN **${finalUsername}**.`)
        .setColor(COLORS.SUCCESS)
        .setTimestamp();
      await logToChannel(interaction.client, interaction.guild.id, logEmbed);
    } catch {}
  }
}

// ─── Update Account Modal Submit (Direct & Instant) ───────────────────────────
export async function handleUpdateAccountModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const rawUsername = interaction.fields.getTextInputValue('minecraft_username').trim();

  if (!isValidMinecraftUsername(rawUsername)) {
    await interaction.editReply({ content: '❌ Invalid Minecraft username format.' });
    return;
  }

  // Check if username taken by another Discord user
  const existingByMc = await prisma.player.findUnique({ where: { minecraftUsernameLower: rawUsername.toLowerCase() } });
  if (existingByMc && existingByMc.discordId !== interaction.user.id) {
    await interaction.editReply({ content: `❌ Minecraft username \`${rawUsername}\` is already registered by another user.` });
    return;
  }

  const { fetchMinecraftProfile, getPlayerHeadUrl } = require('../../services/minecraftService');
  const profile = await fetchMinecraftProfile(rawUsername);
  const uuid = profile?.id ?? null;
  const finalUsername = profile?.name ?? rawUsername;

  const player = await prisma.player.update({
    where: { discordId: interaction.user.id },
    data: {
      minecraftUsername: finalUsername,
      minecraftUsernameLower: finalUsername.toLowerCase(),
      minecraftUuid: uuid,
      lastIgnUpdateAt: new Date(),
      updatedAt: new Date(),
    }
  });

  const successEmbed = new EmbedBuilder()
    .setTitle('🔄 Minecraft Account Updated!')
    .setThumbnail(getPlayerHeadUrl(uuid ?? finalUsername))
    .setDescription(
      `Your linked Minecraft account has been updated to **${finalUsername}**!\n\n` +
      `🎮 **Minecraft IGN:** \`${finalUsername}\`\n` +
      `🆔 **UUID:** \`${uuid ?? 'N/A'}\``
    )
    .setColor(COLORS.SUCCESS)
    .setTimestamp();

  await interaction.editReply({ embeds: [successEmbed] });
}
