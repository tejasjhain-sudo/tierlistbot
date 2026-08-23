import {
  ButtonInteraction,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { Mode, Region, Tier } from '../../config/constants';
import { config } from '../../config';
import prisma from '../../database/prisma';
import { joinQueue, leaveAllQueues, leaveQueue } from '../../services/queueService';
import { giveRegisteredRole, swapWaitlistRole, giveAuthorisedRole, removeUnauthorisedRole, syncGuildMemberRoles } from '../../services/roleService';
import { sendOrUpdateWaitlistPanel } from '../../services/panelService';
import { fetchMinecraftProfile, isValidMinecraftUsername, getPlayerHeadUrl } from '../../services/minecraftService';
import { COLORS, MODES, REGIONS } from '../../config/constants';
import { qualifiesForHighTicket } from '../../services/highTicketService';

// ─── Instant Verify Server Access button ──────────────────────────────────────
export async function handleVerifyServerAccess(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.editReply({ content: '❌ Could not find your member profile in this server.' });
    return;
  }

  await removeUnauthorisedRole(member);
  await giveAuthorisedRole(member);
  await syncGuildMemberRoles(member);

  // Save verification status in SQLite
  try {
    const existingPlayer = await prisma.player.findUnique({ where: { discordId: interaction.user.id } });
    if (existingPlayer) {
      await prisma.player.update({
        where: { discordId: interaction.user.id },
        data: {
          discordAccessToken: existingPlayer.discordAccessToken || 'VERIFIED_DISCORD_ACCESS',
          discordTokenExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        }
      });
    } else {
      await prisma.player.create({
        data: {
          discordId: interaction.user.id,
          minecraftUsername: interaction.user.username,
          minecraftUsernameLower: interaction.user.username.toLowerCase(),
          region: 'AS',
          preferredMode: 'sword',
          discordAccessToken: 'VERIFIED_DISCORD_ACCESS',
          discordTokenExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        }
      });
    }
  } catch (e) {
    console.warn('Error saving verification in SQLite:', e);
  }

  // Backup to Supabase
  try {
    const { createClient } = require('@supabase/supabase-js');
    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
      await supabase.from('backup_players').upsert({
        discord_id: interaction.user.id,
        username: interaction.user.username,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'discord_id' });
    }
  } catch (e) {
    console.warn('[Supabase Backup] Warning:', e);
  }

  const embed = new EmbedBuilder()
    .setTitle('✅ Verification Complete')
    .setDescription(
      `Welcome to **${interaction.guild.name}**!\n\n` +
      `Your account has been verified and backed up! You now have full access to all server channels, announcements, and tier testing queues.\n\n` +
      `Click **Register Minecraft IGN** in the panel above to link your Minecraft username!`
    )
    .setColor(COLORS.SUCCESS)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ─── Register button ──────────────────────────────────────────────────────────
export async function handleRegister(interaction: ButtonInteraction): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId('register_modal')
    .setTitle('Register — Step 1: Minecraft Username');

  const usernameInput = new TextInputBuilder()
    .setCustomId('minecraft_username')
    .setLabel('Minecraft Username')
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(16)
    .setPlaceholder('e.g. Notch')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(usernameInput));
  await interaction.showModal(modal);
}

// ─── Register / Update Profile button ("Request Test") ────────────────────────
export async function handleRegisterUpdate(interaction: ButtonInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle('⚙️ Tier Testing Account Action')
    .setDescription('Please select whether you want to **Register** a new profile or **Update** your existing profile:')
    .setColor(COLORS.PRIMARY);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('action_start_register').setLabel('Register New Profile').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('action_start_update').setLabel('Update Existing Profile').setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

// ─── Action: Start Register ───────────────────────────────────────────────────
export async function handleActionStartRegister(interaction: ButtonInteraction): Promise<void> {
  const player = await prisma.player.findUnique({ where: { discordId: interaction.user.id } });
  if (player) {
    await interaction.reply({
      content: '❌ You are already registered as **' + player.minecraftUsername + '**. Select **Update Existing Profile** if you wish to change your details.',
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId('register_modal')
    .setTitle('Request Test — Step 1: Username');

  const usernameInput = new TextInputBuilder()
    .setCustomId('minecraft_username')
    .setLabel('Minecraft Username')
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(16)
    .setPlaceholder('e.g. Notch')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(usernameInput));
  await interaction.showModal(modal);
}

// ─── Action: Start Update — sends player to verify server to re-link MC account ─
export async function handleActionStartUpdate(interaction: ButtonInteraction): Promise<any> {
  const player = await prisma.player.findUnique({ where: { discordId: interaction.user.id } });
  if (!player) {
    await interaction.reply({
      content: '❌ You are not registered yet. Click **Verify Account** first.',
      ephemeral: true,
    });
    return;
  }

  if (player.lastIgnUpdateAt) {
    const daysSinceUpdate = (Date.now() - player.lastIgnUpdateAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceUpdate < 3) {
      const remainingHours = Math.ceil((3 - daysSinceUpdate) * 24);
      await interaction.reply({
        content: `⏳ You can only update your Minecraft IGN once every 3 days. Please try again in **${remainingHours} hours**.`,
        ephemeral: true,
      });
      return;
    }
  }

  const modal = new ModalBuilder()
    .setCustomId('update_account_modal')
    .setTitle('Update Minecraft Account');

  const usernameInput = new TextInputBuilder()
    .setCustomId('minecraft_username')
    .setLabel('Minecraft Username you will join with')
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(16)
    .setPlaceholder('Enter your current IGN')
    .setValue(player.minecraftUsername)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(usernameInput));
  await interaction.showModal(modal);
}

// ─── Update Profile button ────────────────────────────────────────────────────
export async function handleUpdateProfile(interaction: ButtonInteraction): Promise<void> {
  const player = await prisma.player.findUnique({ where: { discordId: interaction.user.id } });
  if (!player) {
    await interaction.reply({ content: '❌ You are not registered yet. Click **Register** first.', ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId('update_profile_modal')
    .setTitle('Update Profile');

  const usernameInput = new TextInputBuilder()
    .setCustomId('minecraft_username')
    .setLabel('New Minecraft Username (leave blank to keep)')
    .setStyle(TextInputStyle.Short)
    .setMinLength(0)
    .setMaxLength(16)
    .setValue(player.minecraftUsername)
    .setRequired(false);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(usernameInput));
  await interaction.showModal(modal);
}

// ─── My Profile button ────────────────────────────────────────────────────────
export async function handleMyProfile(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const player = await prisma.player.findUnique({
    where: { discordId: interaction.user.id },
    include: { tiers: true, tierHistory: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });

  if (!player) {
    await interaction.editReply({ content: '❌ You are not registered. Click **Register** to get started.' });
    return;
  }

  const tiersDisplay = Object.entries(MODES).map(([key, label]) => {
    const t = player.tiers.find(t => t.mode === key);
    return `**${label}:** ${t?.currentTier ?? 'Unranked'}`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`👤 ${player.minecraftUsername}`)
    .setThumbnail(getPlayerHeadUrl(player.minecraftUuid ?? player.minecraftUsername))
    .addFields(
      { name: '🌍 Region', value: `\`${player.region}\``, inline: true },
      { name: '⚔️ Preferred Mode', value: MODES[player.preferredMode as Mode] || player.preferredMode, inline: true },
      { name: '📅 Registered', value: `<t:${Math.floor(player.registeredAt.getTime() / 1000)}:D>`, inline: true },
      { name: '🏆 Tiers', value: tiersDisplay },
    )
    .setColor(COLORS.PRIMARY)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ─── Leave All Queues button ──────────────────────────────────────────────────
export async function handleLeaveAllQueues(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });

  const result = await leaveAllQueues(interaction.guild.id, interaction.user.id);

  if (result.success && result.count > 0) {
    // Remove all waitlist roles
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};
    const member = interaction.guild.members.cache.get(interaction.user.id);
    if (member) {
      for (const roleId of Object.values(roleIds.waitlists ?? {}) as string[]) {
        try { await member.roles.remove(roleId); } catch {}
      }
    }
    // Refresh all panels in parallel for speed
    await Promise.all(
      (['sword','axe','nethpot','dpot','uhc','smp','crystal','mace'] as Mode[]).map(
        mode => sendOrUpdateWaitlistPanel(interaction.guild!, mode)
      )
    );
  }

  await interaction.editReply({ content: result.success ? `✅ ${result.message}` : `❌ ${result.message}` });
}

// ─── Queue Join button ────────────────────────────────────────────────────────
export async function handleQueueJoin(interaction: ButtonInteraction, mode: Mode): Promise<void> {
  if (!interaction.guild) return;
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  // 1. Enforce Main Server Membership (if secondary server)
  const mainServerId = config.discordGuildId;
  if (mainServerId && interaction.guild.id !== mainServerId) {
    try {
      const mainGuild = await interaction.client.guilds.fetch(mainServerId);
      const isMember = await mainGuild.members.fetch(interaction.user.id).catch(() => null);
      if (!isMember) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Main Server Required')
          .setDescription('You must be a member of the **Main RearMC Discord** to join the waitlist!\n\nPlease join using the link below, then try again.')
          .setColor(COLORS.DANGER);
          
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setLabel('Join Main Server').setStyle(ButtonStyle.Link).setURL('https://discord.gg/bFsSFjDmbs')
        );
        await interaction.editReply({ embeds: [embed], components: [row] });
        return;
      }
    } catch (e) {
      console.error('Failed to check main server membership:', e);
    }
  }

  const player = await prisma.player.findUnique({ where: { discordId: interaction.user.id } });
  if (!player) {
    await interaction.editReply({ content: '❌ You need to register first in #register.' });
    return;
  }

  const result = await joinQueue(interaction.guild.id, interaction.user.id, mode, player.region as Region);

  if (result.success) {
    await sendOrUpdateWaitlistPanel(interaction.guild, mode);
    
    try {
      const { logToChannel } = require('../../utils/logger');
      const logEmbed = new EmbedBuilder()
        .setTitle('📥 Queue Join')
        .setDescription(`<@${interaction.user.id}> joined the **${mode}** waitlist.`)
        .setColor(COLORS.PRIMARY)
        .setTimestamp();
      await logToChannel(interaction.client, interaction.guild.id, logEmbed);
    } catch (e) { console.error(e); }
  }

  await interaction.editReply({ content: result.success ? `✅ ${result.message}` : `❌ ${result.message}` });
}

// ─── Queue Leave button ───────────────────────────────────────────────────────
export async function handleQueueLeave(interaction: ButtonInteraction, mode: Mode): Promise<void> {
  if (!interaction.guild) return;
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  const result = await leaveQueue(interaction.guild.id, interaction.user.id, mode);

  if (result.success) {
    await sendOrUpdateWaitlistPanel(interaction.guild, mode);
    
    try {
      const { logToChannel } = require('../../utils/logger');
      const logEmbed = new EmbedBuilder()
        .setTitle('📤 Queue Leave')
        .setDescription(`<@${interaction.user.id}> left the **${mode}** waitlist.`)
        .setColor(COLORS.DANGER)
        .setTimestamp();
      await logToChannel(interaction.client, interaction.guild.id, logEmbed);
    } catch (e) { console.error(e); }
  }

  await interaction.editReply({ content: result.success ? `✅ ${result.message}` : `❌ ${result.message}` });
}

// ─── Queue My Position button ─────────────────────────────────────────────────
export async function handleQueuePosition(interaction: ButtonInteraction, mode: Mode): Promise<void> {
  if (!interaction.guild) return;
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  const player = await prisma.player.findUnique({ where: { discordId: interaction.user.id } });
  if (!player) { await interaction.editReply({ content: '❌ You are not registered.' }); return; }

  const queue = await prisma.queueEntry.findMany({
    where: { guildId: interaction.guild.id, mode, status: 'WAITING' },
    orderBy: { joinedAt: 'asc' },
  });

  const pos = queue.findIndex(q => q.playerId === player.id);
  if (pos === -1) {
    await interaction.editReply({ content: `❌ You are not in the **${MODES[mode]}** queue.` });
  } else {
    await interaction.editReply({ content: `ℹ️ Your position in **${MODES[mode]}** queue is **#${pos + 1}** out of ${queue.length}.` });
  }
}

// ─── Queue Refresh button ─────────────────────────────────────────────────────
export async function handleQueueRefresh(interaction: ButtonInteraction, mode: Mode): Promise<void> {
  if (!interaction.guild) return;
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }
  await sendOrUpdateWaitlistPanel(interaction.guild, mode);
  await interaction.editReply({ content: `✅ Refreshed **${MODES[mode]}** panel.` });
}

// ─── Verify Account / Register button ─────────────────────────────────────────
export async function handleVerifyAccount(interaction: ButtonInteraction): Promise<any> {
  const discordId = interaction.user.id;

  const player = await prisma.player.findUnique({ where: { discordId } });

  // If already registered with a valid Minecraft IGN and UUID
  if (player && player.minecraftUuid && !player.minecraftUsername.startsWith('User_')) {
    const embed = new EmbedBuilder()
      .setTitle('✅ Already Registered')
      .setThumbnail(getPlayerHeadUrl(player.minecraftUuid ?? player.minecraftUsername))
      .setDescription(
        `Your Discord account is already linked to your Minecraft account.\n\n` +
        `🎮 **Minecraft IGN:** \`${player.minecraftUsername}\`\n` +
        `🆔 **Minecraft UUID:** \`${player.minecraftUuid ?? 'N/A'}\`\n` +
        `🌍 **Region:** \`${player.region}\`\n` +
        `⚔️ **Preferred Mode:** \`${MODES[player.preferredMode as Mode] || player.preferredMode}\`\n\n` +
        `_Need to change your details? Click **⚙️ Update Account**._`
      )
      .setColor(COLORS.SUCCESS);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId('register_modal')
    .setTitle('Link Minecraft Account');

  const usernameInput = new TextInputBuilder()
    .setCustomId('minecraft_username')
    .setLabel('Your Minecraft Username')
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(16)
    .setPlaceholder('Enter your exact Minecraft IGN')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(usernameInput));
  await interaction.showModal(modal);
}

// Helper to perform the actual normal waitlist joining logic
async function processNormalWaitlistJoin(interaction: ButtonInteraction, player: any): Promise<any> {
  const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild!.id } });
  const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};
  
  let member: any;
  try {
    member = await interaction.guild!.members.fetch(player.discordId);
  } catch (err) {
    return interaction.editReply({ content: '❌ Could not find your member profile in this server.' });
  }

  const waitlistMap = (roleIds.waitlists as Record<string, string>) || {};
  const rolesToAdd: string[] = [];
  const modesAdded: string[] = [];
  const missingRoles: string[] = [];

  for (const [modeKey, modeLabel] of Object.entries(MODES)) {
    const roleId = waitlistMap[modeKey];
    if (roleId) {
      if (interaction.guild!.roles.cache.has(roleId)) {
        rolesToAdd.push(roleId);
        modesAdded.push(modeLabel);
      } else {
        missingRoles.push(modeLabel);
      }
    }
  }

  if (rolesToAdd.length === 0) {
    return interaction.editReply({
      content: '❌ No waitlist roles are currently configured in this server. Please have an admin run `/setup` or `/setup-roles`.',
    });
  }

  try {
    // Add all roles in 1 fast atomic API call
    await member.roles.add(rolesToAdd);
  } catch (err: any) {
    console.error('Failed to assign waitlist roles:', err);
    return interaction.editReply({
      content: `❌ **Failed to assign waitlist roles!**\nError: \`${err.message || 'Missing Permissions'}\`\n\n💡 **Admin Fix:** In **Server Settings ➔ Roles**, make sure the **Bot role is dragged ABOVE all Waitlist roles** so it has permission to give them!`,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('✅ Waitlists Joined Successfully')
    .setDescription(
      `👤 **IGN:** \`${player.minecraftUsername}\`\n\n` +
      `You have been granted access to the following waitlist queues:\n` +
      modesAdded.map(m => `• **${m} Waitlist** ✅`).join('\n') +
      (missingRoles.length > 0 ? `\n\n⚠️ _Unconfigured in server: ${missingRoles.join(', ')}_` : '')
    )
    .setColor(COLORS.SUCCESS)
    .setFooter({ text: 'You can now view and chat in the waitlist channels!' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed], components: [] });
}

// ─── Enter Waitlist button ────────────────────────────────────────────────────
export async function handleEnterWaitlist(interaction: ButtonInteraction): Promise<any> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }
  const discordId = interaction.user.id;
  if (!interaction.guild) return interaction.editReply({ content: '❌ Must be used in a server.' });

  // 1. Check if the player is verified
  const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
  const roleIds = (guildConfig?.roleIds as Record<string, any>) || {};
  const authorisedRoleId = roleIds.authorised || roleIds.verified;
  const member = interaction.guild.members.cache.get(discordId);

  const hasAuthorisedRole = authorisedRoleId
    ? (member?.roles.cache.has(authorisedRoleId) ?? false)
    : (member?.roles.cache.some(r => r.name.toLowerCase() === 'authorised' || r.name.toLowerCase() === 'verified') ?? false);
  const isServerAdmin = interaction.guild.ownerId === discordId || (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false);

  if (!hasAuthorisedRole && !isServerAdmin) {
    const embed = new EmbedBuilder()
      .setTitle('❌ Verification Required')
      .setDescription(
        'You must verify your account first before joining the waitlist!\n\n' +
        '👉 Please click **🛡️ Verify Account** in the panel above first.'
      )
      .setColor(COLORS.WARNING);

    return interaction.editReply({ embeds: [embed] });
  }

  // 2. Enforce Main Server Membership
  const mainServerId = config.discordGuildId;
  if (mainServerId && interaction.guild.id !== mainServerId) {
    try {
      const mainGuild = await interaction.client.guilds.fetch(mainServerId);
      const isMember = await mainGuild.members.fetch(discordId).catch(() => null);
      if (!isMember) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Main Server Required')
          .setDescription('You must be a member of the **Main RearMC Discord** to join the waitlist!\n\nPlease join using the link below, then try again.')
          .setColor(COLORS.DANGER);
          
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setLabel('Join Main Server').setStyle(ButtonStyle.Link).setURL('https://discord.gg/bFsSFjDmbs')
        );
        
        return interaction.editReply({ embeds: [embed], components: [row] });
      }
    } catch (e) {
      console.error('Failed to check main server membership:', e);
    }
  }

  const player = await prisma.player.findUnique({
    where: { discordId },
    include: { tiers: true }
  });
  if (!player || !player.minecraftUsername || player.minecraftUsername === `User_${discordId.slice(-4)}`) {
    const embed = new EmbedBuilder()
      .setTitle('❌ Registration Required')
      .setDescription(
        'You need to register your Minecraft account first before joining the waitlist.\n\n' +
        '👉 Please click **📝 Register Minecraft IGN** in the panel above!'
      )
      .setColor(COLORS.DANGER);
    return interaction.editReply({ embeds: [embed] });
  }

  // 2. Check if they qualify for a High Tier Test in any mode
  const qualifyingTiers = player.tiers.filter(pt => qualifiesForHighTicket(pt.currentTier as Tier));
  if (qualifyingTiers.length > 0) {
    // They qualify for high tier tests! Ask which kit they want to test
    const selectOptions = qualifyingTiers.map(pt =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${MODES[pt.mode as Mode] || pt.mode} (Current: ${pt.currentTier})`)
        .setValue(pt.mode)
    );

    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('select_high_ticket_mode')
        .setPlaceholder('Select gamemode for High Tier Test')
        .addOptions(selectOptions)
    );

    const bypassRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('join_normal_waitlists')
        .setLabel('Join Normal Waitlists Instead')
        .setStyle(ButtonStyle.Secondary)
    );

    const embed = new EmbedBuilder()
      .setTitle('🔥 High Tier Qualification Detected')
      .setDescription(
        `Based on your current ranks, you qualify to open a **High Tier Test**!\n\n` +
        `Please select the kit/gamemode you want to test from the dropdown below to open a ticket, or click the button below to join the standard waitlists.`
      )
      .setColor(COLORS.PRIMARY);

    return interaction.editReply({ embeds: [embed], components: [selectRow, bypassRow] });
  }

  // If they don't qualify for high tier, just join normal waitlists
  return processNormalWaitlistJoin(interaction, player);
}

// ─── Join Normal Waitlists button (bypass HT check) ───────────────────────────
export async function handleJoinNormalWaitlists(interaction: ButtonInteraction): Promise<any> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }
  const discordId = interaction.user.id;
  if (!interaction.guild) return interaction.editReply({ content: '❌ Must be used in a server.' });

  const player = await prisma.player.findUnique({ where: { discordId } });
  if (!player) {
    return interaction.editReply({ content: '❌ You must be registered.' });
  }

  return processNormalWaitlistJoin(interaction, player);
}

// ─── View Cooldown button ─────────────────────────────────────────────────────
export async function handleViewCooldown(interaction: ButtonInteraction): Promise<any> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }
  const discordId = interaction.user.id;

  const player = await prisma.player.findUnique({ where: { discordId } });
  if (!player) {
    return interaction.editReply({ content: '❌ You are not registered.' });
  }

  const cooldowns = (player.waitlistRoleCooldowns as Record<string, string>) ?? {};
  const lines: string[] = [];

  for (const [modeKey, modeLabel] of Object.entries(MODES)) {
    const cd = cooldowns[modeKey];
    if (cd && new Date(cd).getTime() > Date.now()) {
      lines.push(`• **${modeLabel}:** On cooldown until <t:${Math.floor(new Date(cd).getTime() / 1000)}:R>`);
    } else {
      lines.push(`• **${modeLabel}:** Available ✅`);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(`⏳ Waitlist Cooldown Status — ${player.minecraftUsername}`)
    .setDescription(lines.join('\n'))
    .setColor(COLORS.PRIMARY);

  return interaction.editReply({ embeds: [embed] });
}
