import { Guild, Role, TextChannel, CategoryChannel, OverwriteType, PermissionFlagsBits } from 'discord.js';
import { Mode, Region } from '../config/constants';
import prisma from '../database/prisma';
import { MODE_LIST, MODES, TIERS } from '../config/constants';

interface GuildConfigChannelIds {
  register?: string;
  howToTest?: string;
  leaderboard?: string;
  updates?: string;
  history?: string;
  botLogs?: string;
  staffControls?: string;
  waitlists?: Record<string, string>;
}

interface GuildConfigRoleIds {
  registered?: string;
  tierTester?: string;
  tierManager?: string;
  tierAdmin?: string;
  waitlists?: Record<string, string>;
  testers?: Record<string, string>;
  tiers?: Record<string, Record<string, string>>;
}

interface GuildConfigCategoryIds {
  tierTesting?: string;
  waitlists?: string;
  tickets?: string;
  logs?: string;
  staff?: string;
}

export async function runSetup(guild: Guild): Promise<string> {
  const logs: string[] = [];

  // Load or initialize guild config
  let guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });

  const categoryIds: GuildConfigCategoryIds = (guildConfig?.categoryIds as GuildConfigCategoryIds) ?? {};
  const channelIds: GuildConfigChannelIds = (guildConfig?.channelIds as GuildConfigChannelIds) ?? {};
  const roleIds: GuildConfigRoleIds = (guildConfig?.roleIds as GuildConfigRoleIds) ?? {};
  const panelMessageIds: Record<string, string> = (guildConfig?.panelMessageIds as Record<string, string>) ?? {};
  const settings = (guildConfig?.settings as Record<string, unknown>) ?? {};

  // ─── Helper: find or create role ───────────────────────────────────────────
  async function ensureRole(name: string, color?: number): Promise<Role> {
    const existing = guild.roles.cache.find(r => r.name === name);
    if (existing) { logs.push(`Role exists: ${name}`); return existing; }
    const role = await guild.roles.create({ name, color, reason: 'RearMC /setup' });
    logs.push(`Created role: ${name}`);
    return role;
  }

  // ─── Helper: find or create category ───────────────────────────────────────
  async function ensureCategory(name: string): Promise<CategoryChannel> {
    const existing = guild.channels.cache.find(c => c.type === 4 && c.name === name) as CategoryChannel | undefined;
    if (existing) { logs.push(`Category exists: ${name}`); return existing; }
    const cat = await guild.channels.create({ name, type: 4, reason: 'RearMC /setup' }) as unknown as CategoryChannel;
    logs.push(`Created category: ${name}`);
    return cat;
  }

  // ─── Helper: find or create text channel ───────────────────────────────────
  async function ensureChannel(name: string, parent: CategoryChannel, permissionOverwrites?: any[]): Promise<TextChannel> {
    const existing = guild.channels.cache.find(c => c.name === name && c.parentId === parent.id) as TextChannel | undefined;
    if (existing) { logs.push(`Channel exists: #${name}`); return existing; }
    const ch = await guild.channels.create({
      name,
      type: 0,
      parent: parent.id,
      permissionOverwrites: permissionOverwrites ?? [],
      reason: 'RearMC /setup',
    }) as TextChannel;
    logs.push(`Created channel: #${name}`);
    return ch;
  }

  // ─── 1. Create General Roles ────────────────────────────────────────────────
  const registeredRole = await ensureRole('Registered', 0x2ECC71);
  const tierTesterRole = await ensureRole('Tier Tester', 0x3498DB);
  const tierManagerRole = await ensureRole('Tier Manager', 0x9B59B6);
  const tierAdminRole = await ensureRole('Tier Admin', 0xE74C3C);

  roleIds.registered = registeredRole.id;
  roleIds.tierTester = tierTesterRole.id;
  roleIds.tierManager = tierManagerRole.id;
  roleIds.tierAdmin = tierAdminRole.id;

  // ─── 2. Create Waitlist & Tester Roles ─────────────────────────────────────
  roleIds.waitlists = roleIds.waitlists ?? {};
  roleIds.testers = roleIds.testers ?? {};

  const modeWaitlistRoles: Record<string, Role> = {};
  const modeTesterRoles: Record<string, Role> = {};

  for (const mode of MODE_LIST) {
    const label = MODES[mode];
    const waitlistRole = await ensureRole(`Waitlist ${label}`, 0x1ABC9C);
    const testerRole = await ensureRole(`${label} Tester`, 0xE67E22);
    roleIds.waitlists[mode] = waitlistRole.id;
    roleIds.testers[mode] = testerRole.id;
    modeWaitlistRoles[mode] = waitlistRole;
    modeTesterRoles[mode] = testerRole;
  }

  // ─── 3. Create Tier Roles ───────────────────────────────────────────────────
  roleIds.tiers = roleIds.tiers ?? {};
  for (const mode of MODE_LIST) {
    roleIds.tiers[mode] = roleIds.tiers[mode] ?? {};
    for (const tier of TIERS) {
      if (tier === 'Unranked') continue;
      const roleName = `${MODES[mode]} ${tier}`;
      const tierRole = await ensureRole(roleName);
      roleIds.tiers[mode][tier] = tierRole.id;
    }
  }

  // ─── 4. Create Categories ───────────────────────────────────────────────────
  const catTierTesting = await ensureCategory('REARMC TIER TESTING');
  const catWaitlists = await ensureCategory('WAITLISTS');
  const catTickets = await ensureCategory('TESTING TICKETS');
  const catLogs = await ensureCategory('TIER LOGS');
  const catStaff = await ensureCategory('STAFF');

  categoryIds.tierTesting = catTierTesting.id;
  categoryIds.waitlists = catWaitlists.id;
  categoryIds.tickets = catTickets.id;
  categoryIds.logs = catLogs.id;
  categoryIds.staff = catStaff.id;

  // ─── 5. Create Public Channels ──────────────────────────────────────────────
  const everyoneRole = guild.roles.everyone;

  const registerCh = await ensureChannel('register', catTierTesting);
  const howToTestCh = await ensureChannel('how-to-test', catTierTesting);
  const leaderboardCh = await ensureChannel('tier-leaderboard', catTierTesting);

  const updatesCh = await ensureChannel('tier-updates', catLogs, [
    { id: everyoneRole.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
  ]);
  const historyCh = await ensureChannel('test-history', catLogs, [
    { id: everyoneRole.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
  ]);
  const botLogsCh = await ensureChannel('bot-logs', catLogs, [
    { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: tierManagerRole.id, allow: [PermissionFlagsBits.ViewChannel] },
    { id: tierAdminRole.id, allow: [PermissionFlagsBits.ViewChannel] },
  ]);
  const staffControlsCh = await ensureChannel('staff-controls', catStaff, [
    { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: tierTesterRole.id, allow: [PermissionFlagsBits.ViewChannel] },
    { id: tierManagerRole.id, allow: [PermissionFlagsBits.ViewChannel] },
    { id: tierAdminRole.id, allow: [PermissionFlagsBits.ViewChannel] },
  ]);

  channelIds.register = registerCh.id;
  channelIds.howToTest = howToTestCh.id;
  channelIds.leaderboard = leaderboardCh.id;
  channelIds.updates = updatesCh.id;
  channelIds.history = historyCh.id;
  channelIds.botLogs = botLogsCh.id;
  channelIds.staffControls = staffControlsCh.id;

  // ─── 6. Create Waitlist Channels ────────────────────────────────────────────
  channelIds.waitlists = channelIds.waitlists ?? {};

  for (const mode of MODE_LIST) {
    const waitlistRole = modeWaitlistRoles[mode];
    const testerRole = modeTesterRoles[mode];
    const ch = await ensureChannel(`waitlist-${mode}`, catWaitlists, [
      { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      { id: waitlistRole.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
      { id: testerRole.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
      { id: tierTesterRole.id, allow: [PermissionFlagsBits.ViewChannel] },
      { id: tierManagerRole.id, allow: [PermissionFlagsBits.ViewChannel] },
      { id: tierAdminRole.id, allow: [PermissionFlagsBits.ViewChannel] },
    ]);
    channelIds.waitlists[mode] = ch.id;
  }

  // ─── 7. Deny @everyone view on the Tickets category ────────────────────────
  await catTickets.permissionOverwrites.edit(everyoneRole, {
    ViewChannel: false,
  });

  // ─── 8. Save config to database ─────────────────────────────────────────────
  await prisma.guildConfig.upsert({
    where: { guildId: guild.id },
    update: { categoryIds: categoryIds as any, channelIds: channelIds as any, roleIds: roleIds as any, panelMessageIds: panelMessageIds as any, settings: settings as any },
    create: { guildId: guild.id, categoryIds: categoryIds as any, channelIds: channelIds as any, roleIds: roleIds as any, panelMessageIds: panelMessageIds as any, settings: settings as any },
  });

  return logs.join('\n');
}

/**
 * Auto-detects user-created channels and creates only missing roles (NEVER deletes any channel or role).
 */
export async function autoDetectChannelsAndEnsureRoles(guild: Guild): Promise<void> {
  await guild.channels.fetch().catch(() => {});
  await guild.roles.fetch().catch(() => {});

  const channels = Array.from(guild.channels.cache.values());
  const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });

  const channelIds: Record<string, any> = (guildConfig?.channelIds as Record<string, any>) || {};
  const waitlists: Record<string, string> = channelIds.waitlists || {};
  const roleIds: Record<string, any> = (guildConfig?.roleIds as Record<string, any>) || {};
  const waitlistRoles: Record<string, string> = roleIds.waitlists || {};
  const testerRoles: Record<string, string> = roleIds.testers || {};
  const tierRoles: Record<string, Record<string, string>> = roleIds.tiers || {};

  // Helper to find channel by keyword
  const findChannel = (...keywords: string[]): TextChannel | undefined => {
    return channels.find(
      (c) =>
        c.isTextBased() &&
        keywords.some((k) => c.name.toLowerCase().includes(k.toLowerCase()))
    ) as TextChannel | undefined;
  };

  // Helper to find or create role (never deletes)
  async function getOrCreateRole(name: string, color?: number): Promise<Role> {
    const existing = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    try {
      return await guild.roles.create({ name, color, reason: 'Auto-created missing tierlist role' });
    } catch (e) {
      console.warn(`Could not create role ${name}:`, e);
      return existing || (guild.roles.cache.first() as Role);
    }
  }

  // 1. Detect waitlist channels that user created
  for (const [modeKey] of Object.entries(MODES)) {
    const waitlistCh = findChannel(`waitlist-${modeKey}`, `${modeKey}-waitlist`, `waitlist_${modeKey}`, modeKey);
    if (waitlistCh) {
      waitlists[modeKey] = waitlistCh.id;
    }
  }
  channelIds.waitlists = waitlists;

  // 2. Detect core panel channels
  const registerCh = findChannel('request-test', 'register', 'apply-test', 'verification');
  if (registerCh) channelIds.register = registerCh.id;

  const supportCh = findChannel('request-support', 'support', 'tickets');
  if (supportCh) channelIds.requestSupport = supportCh.id;

  const resultsCh = findChannel('results', 'tier-results');
  if (resultsCh) channelIds.results = resultsCh.id;

  const highResultsCh = findChannel('high-results', 'ht-results');
  if (highResultsCh) channelIds.highResults = highResultsCh.id;

  const applicationsCh = findChannel('applications', 'tester-apps');
  if (applicationsCh) channelIds.applications = applicationsCh.id;

  // 3. Ensure essential roles exist (never deletes existing roles)
  const regRole = await getOrCreateRole('Registered', 0x2ECC71);
  roleIds.registered = regRole.id;

  const authRole = await getOrCreateRole('Authorised', 0x3498DB);
  roleIds.authorised = authRole.id;

  const unauthRole = await getOrCreateRole('Unauthorised', 0x95A5A6);
  roleIds.unauthorised = unauthRole.id;

  const testerRole = await getOrCreateRole('Tier Tester', 0x3498DB);
  roleIds.tierTester = testerRole.id;

  const adminRole = await getOrCreateRole('Tier Admin', 0xE74C3C);
  roleIds.tierAdmin = adminRole.id;

  // Gamemode waitlist & tester roles
  for (const mode of MODE_LIST) {
    const label = MODES[mode];
    const wRole = await getOrCreateRole(`Waitlist ${label}`, 0x1ABC9C);
    const tRole = await getOrCreateRole(`${label} Tester`, 0xE67E22);
    waitlistRoles[mode] = wRole.id;
    testerRoles[mode] = tRole.id;

    // Gamemode tier roles
    tierRoles[mode] = tierRoles[mode] || {};
    for (const tier of TIERS) {
      if (tier === 'Unranked') continue;
      const tierRoleObj = await getOrCreateRole(`${label} ${tier}`);
      tierRoles[mode][tier] = tierRoleObj.id;
    }
  }

  roleIds.waitlists = waitlistRoles;
  roleIds.testers = testerRoles;
  roleIds.tiers = tierRoles;

  // Save to database
  await prisma.guildConfig.upsert({
    where: { guildId: guild.id },
    update: { channelIds, roleIds },
    create: {
      guildId: guild.id,
      channelIds,
      roleIds,
      categoryIds: {},
      panelMessageIds: {},
    },
  });

  // Deploy panels only to the detected channels
  try {
    const { sendOrUpdateAllServerPanels } = await import('./panelService');
    await sendOrUpdateAllServerPanels(guild);
  } catch (err) {
    console.error(`Error sending panels for ${guild.name}:`, err);
  }
}

