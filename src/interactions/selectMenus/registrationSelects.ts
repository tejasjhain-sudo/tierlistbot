import {
  StringSelectMenuInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  EmbedBuilder,
} from 'discord.js';
import { Mode, Region } from '../../config/constants';
import prisma from '../../database/prisma';
import { fetchMinecraftProfile } from '../../services/minecraftService';
import { giveRegisteredRole, swapWaitlistRole } from '../../services/roleService';
import { joinQueue } from '../../services/queueService';
import { sendOrUpdateWaitlistPanel } from '../../services/panelService';
import { COLORS, MODES } from '../../config/constants';

// ─── Region select (registration step 2) ─────────────────────────────────────
export async function handleRegisterRegion(
  interaction: StringSelectMenuInteraction,
  mcUsername: string
): Promise<void> {
  const region = interaction.values[0] as Region;

  // Show mode select
  const modeSelect = new StringSelectMenuBuilder()
    .setCustomId(`register_mode_${encodeURIComponent(mcUsername)}_${region}`)
    .setPlaceholder('Select your preferred mode')
    .addOptions(
      Object.entries(MODES).map(([key, label]) =>
        new StringSelectMenuOptionBuilder().setLabel(label).setValue(key)
      )
    );

  const embed = new EmbedBuilder()
    .setTitle('📋 Registration — Step 3: Select Mode')
    .setDescription(`Username: \`${mcUsername}\` | Region: \`${region}\`\n\nSelect the mode you want to be tested in:`)
    .setColor(COLORS.PRIMARY);

  await interaction.update({
    embeds: [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modeSelect)],
  });
}

// ─── Mode select (registration step 3 — finalize) ────────────────────────────
export async function handleRegisterMode(
  interaction: StringSelectMenuInteraction,
  mcUsername: string,
  region: Region
): Promise<void> {
  if (!interaction.guild) return;

  await interaction.deferUpdate();

  const mode = interaction.values[0] as Mode;

  // Fetch Mojang profile
  const profile = await fetchMinecraftProfile(mcUsername);
  const finalUsername = profile?.name ?? mcUsername;
  const uuid = profile?.id ?? null;

  // Check if username taken by someone else
  const existingByMc = await prisma.player.findUnique({ where: { minecraftUsernameLower: finalUsername.toLowerCase() } });
  if (existingByMc && existingByMc.discordId !== interaction.user.id) {
    await interaction.editReply({ content: `❌ Username \`${finalUsername}\` is already registered by another Discord user.`, components: [], embeds: [] });
    return;
  }

  // Create or Update player profile (preserving OAuth backup tokens)
  const player = await prisma.player.upsert({
    where: { discordId: interaction.user.id },
    update: {
      minecraftUsername: finalUsername,
      minecraftUsernameLower: finalUsername.toLowerCase(),
      minecraftUuid: uuid,
      region,
      preferredMode: mode,
      updatedAt: new Date(),
    },
    create: {
      discordId: interaction.user.id,
      minecraftUsername: finalUsername,
      minecraftUsernameLower: finalUsername.toLowerCase(),
      minecraftUuid: uuid,
      region,
      preferredMode: mode,
    },
  });

  // Give registered role, authorised role, and waitlist role for preferred mode
  try {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const { giveRegisteredRole, giveAuthorisedRole, removeUnauthorisedRole, swapWaitlistRole } = require('../../services/roleService');
    await giveAuthorisedRole(member);
    await removeUnauthorisedRole(member);
    await giveRegisteredRole(member);
    await swapWaitlistRole(member, null, mode);
  } catch (e) {
    console.error('Error assigning roles:', e);
  }

  const embed = new EmbedBuilder()
    .setTitle('✅ Registration Complete!')
    .setDescription(`Welcome to **RearMC Tier Testing**, **${finalUsername}**!\n\nYour profile has been saved. To enter testing, select a gamemode role or click **Join Queue** on an open testing waitlist panel.`)
    .addFields(
      { name: '🎮 Minecraft Username', value: `\`${finalUsername}\``, inline: true },
      { name: '🌍 Region', value: `\`${region}\``, inline: true },
      { name: '⚔️ Preferred Mode', value: MODES[mode], inline: true },
    )
    .setColor(COLORS.SUCCESS)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed], components: [] });

  try {
    const { logToChannel } = require('../../utils/logger');
    const logEmbed = new EmbedBuilder()
      .setTitle('👤 New Player Registered')
      .setDescription(`<@${interaction.user.id}> has registered as **${finalUsername}**.`)
      .addFields(
        { name: 'UUID', value: uuid ?? 'Unknown', inline: true },
        { name: 'Region', value: region, inline: true },
        { name: 'Mode', value: MODES[mode], inline: true }
      )
      .setColor(COLORS.SUCCESS)
      .setTimestamp();
    await logToChannel(interaction.client, interaction.guild.id, logEmbed);
  } catch (e) {
    console.error('Logger error:', e);
  }

  // Update waitlist
  try {
    await sendOrUpdateWaitlistPanel(interaction.guild, mode);
  } catch {}
}

// ─── Region select (update profile) ──────────────────────────────────────────
export async function handleUpdateRegion(
  interaction: StringSelectMenuInteraction,
  mcUsername: string
): Promise<void> {
  const region = interaction.values[0] as Region;

  const modeSelect = new StringSelectMenuBuilder()
    .setCustomId(`update_mode_${encodeURIComponent(mcUsername)}_${region}`)
    .setPlaceholder('Select your preferred mode')
    .addOptions(
      Object.entries(MODES).map(([key, label]) =>
        new StringSelectMenuOptionBuilder().setLabel(label).setValue(key)
      )
    );

  await interaction.update({
    content: `Region updated to \`${region}\`. Now select your preferred mode:`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modeSelect)],
    embeds: [],
  });
}

// ─── Mode select (update profile — finalize) ──────────────────────────────────
export async function handleUpdateMode(
  interaction: StringSelectMenuInteraction,
  mcUsername: string,
  region: Region
): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferUpdate();

  const mode = interaction.values[0] as Mode;

  const player = await prisma.player.findUnique({ where: { discordId: interaction.user.id } });
  if (!player) {
    await interaction.editReply({ content: '❌ Player not found.', components: [], embeds: [] });
    return;
  }

  const oldMode = player.preferredMode as Mode;
  const profile = await fetchMinecraftProfile(mcUsername);
  const finalUsername = profile?.name ?? mcUsername;
  const uuid = profile?.id ?? player.minecraftUuid;

  await prisma.player.update({
    where: { discordId: interaction.user.id },
    data: {
      minecraftUsername: finalUsername,
      minecraftUsernameLower: finalUsername.toLowerCase(),
      minecraftUuid: uuid,
      region,
      preferredMode: mode,
    },
  });

  // Swap waitlist roles
  try {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    await swapWaitlistRole(member, oldMode, mode);
  } catch {}

  // Refresh panels
  if (oldMode !== mode) await sendOrUpdateWaitlistPanel(interaction.guild, oldMode);
  await sendOrUpdateWaitlistPanel(interaction.guild, mode);

  await interaction.editReply({
    content: `✅ Profile updated! Username: \`${finalUsername}\`, Region: \`${region}\`, Preferred Mode: **${MODES[mode]}**`,
    components: [],
    embeds: [],
  });
}
