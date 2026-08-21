import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  Role,
  TextChannel,
} from 'discord.js';
import prisma from '../../database/prisma';
import { MODE_LIST, MODES, TIERS, COLORS } from '../../config/constants';
import { Mode } from '../../config/constants';

const READ_ONLY_CHANNELS = [
  'welcome',
  'rules',
  'announcement',
  'community-announcements',
  'updates',
  'events',
  'testing-rules',
  'results',
  'high-results',
  'rubric',
  'verified-servers',
  'how-to-test',
  'tier-leaderboard',
  'tier-updates',
  'test-history',
];

const STAFF_CHANNELS = [
  'staff-controls',
  'bot-logs',
  'staff-movements',
  'punishments',
  'retirement-demotions',
];

export default {
  data: new SlashCommandBuilder()
    .setName('setup-roles')
    .setDescription('Automatically create all tierlist roles and configure channel permissions.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ This command must be used in a server.', ephemeral: true });
    }

    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;

    if (!isOwner && !isAdmin) {
      return interaction.reply({
        content: '❌ Only Administrators or Server Owners can run this command.',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const guild = interaction.guild;
    const logs: string[] = [];

    // Load or initialize GuildConfig
    let guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });

    const roleIds: Record<string, any> = (guildConfig?.roleIds as Record<string, any>) ?? {};
    roleIds.waitlists = roleIds.waitlists ?? {};
    roleIds.testers = roleIds.testers ?? {};
    roleIds.tiers = roleIds.tiers ?? {};

    // Helper: find or create role
    async function ensureRole(name: string, color?: number): Promise<Role> {
      const existing = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
      if (existing) return existing;
      const role = await guild.roles.create({ name, color, reason: '/setup-roles creation' });
      logs.push(`Created role: ${name}`);
      return role;
    }

    // 1. Create General & Staff Roles
    const registeredRole = await ensureRole('Registered', 0x2ECC71);
    const tierTesterRole = await ensureRole('Tier Tester', 0x3498DB);
    const tierManagerRole = await ensureRole('Tier Manager', 0x9B59B6);
    const tierAdminRole = await ensureRole('Tier Admin', 0xE74C3C);

    roleIds.registered = registeredRole.id;
    roleIds.tierTester = tierTesterRole.id;
    roleIds.tierManager = tierManagerRole.id;
    roleIds.tierAdmin = tierAdminRole.id;

    // 2. Create Waitlist & Tester Roles for all modes
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

    // 3. Create Tier Rank Roles for all modes
    let createdTierCount = 0;
    for (const mode of MODE_LIST) {
      roleIds.tiers[mode] = roleIds.tiers[mode] ?? {};
      for (const tier of TIERS) {
        if (tier === 'Unranked') continue;
        const roleName = `${MODES[mode]} ${tier}`;
        const tierRole = await ensureRole(roleName);
        roleIds.tiers[mode][tier] = tierRole.id;
        createdTierCount++;
      }
    }

    // 4. Configure Channel Permissions
    let permsUpdatedCount = 0;
    const everyoneRole = guild.roles.everyone;

    for (const [, channel] of guild.channels.cache) {
      if (!channel.isTextBased() || channel.isThread()) continue;
      const textChannel = channel as TextChannel;
      const cleanName = textChannel.name.toLowerCase().replace(/[^a-z0-9-]/g, '');

      // Read-Only Channels
      if (READ_ONLY_CHANNELS.some(r => cleanName.includes(r))) {
        try {
          await textChannel.permissionOverwrites.edit(everyoneRole, {
            ViewChannel: true,
            SendMessages: false,
          });
          await textChannel.permissionOverwrites.edit(tierAdminRole, {
            ViewChannel: true,
            SendMessages: true,
          });
          permsUpdatedCount++;
        } catch {}
        continue;
      }

      // Staff Channels
      if (STAFF_CHANNELS.some(s => cleanName.includes(s))) {
        try {
          await textChannel.permissionOverwrites.edit(everyoneRole, {
            ViewChannel: false,
          });
          await textChannel.permissionOverwrites.edit(tierTesterRole, {
            ViewChannel: true,
            SendMessages: true,
          });
          await textChannel.permissionOverwrites.edit(tierManagerRole, {
            ViewChannel: true,
            SendMessages: true,
          });
          await textChannel.permissionOverwrites.edit(tierAdminRole, {
            ViewChannel: true,
            SendMessages: true,
          });
          permsUpdatedCount++;
        } catch {}
        continue;
      }

      // Waitlist Channels (e.g. waitlist-sword)
      for (const mode of MODE_LIST) {
        if (cleanName.includes(`waitlist-${mode}`)) {
          const waitlistRole = modeWaitlistRoles[mode];
          const testerRole = modeTesterRoles[mode];
          try {
            await textChannel.permissionOverwrites.edit(everyoneRole, {
              ViewChannel: false,
              SendMessages: false,
            });
            if (waitlistRole) {
              await textChannel.permissionOverwrites.edit(waitlistRole, {
                ViewChannel: true,
                SendMessages: false,
              });
            }
            if (testerRole) {
              await textChannel.permissionOverwrites.edit(testerRole, {
                ViewChannel: true,
                SendMessages: true,
              });
            }
            await textChannel.permissionOverwrites.edit(tierAdminRole, {
              ViewChannel: true,
              SendMessages: true,
            });
            permsUpdatedCount++;
          } catch {}
          break;
        }
      }
    }

    // 5. Save GuildConfig to DB
    await prisma.guildConfig.upsert({
      where: { guildId: guild.id },
      update: { roleIds: roleIds as any },
      create: {
        guildId: guild.id,
        roleIds: roleIds as any,
        categoryIds: {},
        channelIds: {},
        panelMessageIds: {},
        settings: {},
      },
    });

    const embed = new EmbedBuilder()
      .setTitle('✅ Roles & Permissions Setup Complete!')
      .setDescription(`Successfully created tierlist roles and configured channel permissions for **${guild.name}**!`)
      .addFields(
        { name: '👥 General Roles Created/Verified', value: '`Registered`, `Tier Tester`, `Tier Manager`, `Tier Admin`', inline: false },
        { name: '⚔️ Mode Tester & Waitlist Roles', value: `\`${MODE_LIST.length * 2}\` roles created`, inline: true },
        { name: '🏆 Tier Rank Roles Created', value: `\`${createdTierCount}\` roles created`, inline: true },
        { name: '🔒 Channel Perms Configured', value: `\`${permsUpdatedCount}\` channels updated`, inline: true }
      )
      .setColor(COLORS.SUCCESS)
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
