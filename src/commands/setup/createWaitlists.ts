import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  CategoryChannel,
  TextChannel,
} from 'discord.js';
import prisma from '../../database/prisma';
import { MODE_LIST, MODES, COLORS } from '../../config/constants';
import { Mode } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('setup-waitlists')
    .setDescription('Automatically create all gamemode waitlist channels, set permissions, and save config.')
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
    const everyoneRole = guild.roles.everyone;

    // Load or initialize GuildConfig
    let guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });

    const channelIds: Record<string, any> = (guildConfig?.channelIds as Record<string, any>) ?? {};
    channelIds.waitlists = channelIds.waitlists ?? {};

    const categoryIds: Record<string, any> = (guildConfig?.categoryIds as Record<string, any>) ?? {};
    const roleIds: Record<string, any> = (guildConfig?.roleIds as Record<string, any>) ?? {};

    // 1. Find or create WAITLISTS Category
    let waitlistCategory: CategoryChannel | undefined;
    if (categoryIds.waitlists) {
      waitlistCategory = guild.channels.cache.get(categoryIds.waitlists) as CategoryChannel | undefined;
    }
    if (!waitlistCategory) {
      waitlistCategory = guild.channels.cache.find(
        c => c.type === ChannelType.GuildCategory && (c.name.toLowerCase() === 'waitlists' || c.name.toLowerCase().includes('waitlist'))
      ) as CategoryChannel | undefined;
    }
    if (!waitlistCategory) {
      try {
        waitlistCategory = (await guild.channels.create({
          name: 'WAITLISTS',
          type: ChannelType.GuildCategory,
          reason: '/setup-waitlists category creation',
        })) as CategoryChannel;
        categoryIds.waitlists = waitlistCategory.id;
      } catch (err) {
        console.error('Failed to create WAITLISTS category:', err);
      }
    }

    const tierTesterRole = roleIds.tierTester ? guild.roles.cache.get(roleIds.tierTester) : guild.roles.cache.find(r => r.name.toLowerCase() === 'tier tester');
    const tierManagerRole = roleIds.tierManager ? guild.roles.cache.get(roleIds.tierManager) : guild.roles.cache.find(r => r.name.toLowerCase() === 'tier manager');
    const tierAdminRole = roleIds.tierAdmin ? guild.roles.cache.get(roleIds.tierAdmin) : guild.roles.cache.find(r => r.name.toLowerCase() === 'tier admin');

    let createdCount = 0;
    let existingCount = 0;

    // 2. Iterate through all modes and ensure waitlist channel
    for (const mode of MODE_LIST) {
      const chName = `waitlist-${mode}`;
      let ch: TextChannel | undefined;

      // Check existing in DB or Guild
      const existingId = channelIds.waitlists[mode];
      if (existingId) {
        ch = guild.channels.cache.get(existingId) as TextChannel | undefined;
      }
      if (!ch) {
        ch = guild.channels.cache.find(
          c => c.isTextBased() && c.name.toLowerCase() === chName
        ) as TextChannel | undefined;
      }

      if (!ch) {
        try {
          ch = (await guild.channels.create({
            name: chName,
            type: ChannelType.GuildText,
            parent: waitlistCategory ? waitlistCategory.id : undefined,
            reason: '/setup-waitlists creation',
          })) as TextChannel;
          createdCount++;
        } catch (err) {
          console.error(`Failed to create ${chName}:`, err);
          continue;
        }
      } else {
        existingCount++;
        if (waitlistCategory && ch.parentId !== waitlistCategory.id) {
          try { await ch.setParent(waitlistCategory.id); } catch {}
        }
      }

      // Save ID to DB config
      channelIds.waitlists[mode] = ch.id;

      // Configure Permissions for waitlist channel
      const waitlistRoleId = roleIds.waitlists?.[mode];
      const testerRoleId = roleIds.testers?.[mode];

      const waitlistRole = waitlistRoleId ? guild.roles.cache.get(waitlistRoleId) : guild.roles.cache.find(r => r.name.toLowerCase() === `waitlist ${MODES[mode]}`.toLowerCase());
      const testerRole = testerRoleId ? guild.roles.cache.get(testerRoleId) : guild.roles.cache.find(r => r.name.toLowerCase() === `${MODES[mode]} tester`.toLowerCase());

      try {
        await ch.permissionOverwrites.edit(everyoneRole, {
          ViewChannel: false,
          SendMessages: false,
        });
        if (waitlistRole) {
          await ch.permissionOverwrites.edit(waitlistRole, {
            ViewChannel: true,
            SendMessages: false,
          });
        }
        if (testerRole) {
          await ch.permissionOverwrites.edit(testerRole, {
            ViewChannel: true,
            SendMessages: true,
          });
        }
        if (tierTesterRole) {
          await ch.permissionOverwrites.edit(tierTesterRole, {
            ViewChannel: true,
            SendMessages: true,
          });
        }
        if (tierManagerRole) {
          await ch.permissionOverwrites.edit(tierManagerRole, {
            ViewChannel: true,
            SendMessages: true,
          });
        }
        if (tierAdminRole) {
          await ch.permissionOverwrites.edit(tierAdminRole, {
            ViewChannel: true,
            SendMessages: true,
          });
        }
      } catch (e) {
        console.error(`Failed to set permissions on ${chName}:`, e);
      }
    }

    // 3. Save updated GuildConfig to Database
    await prisma.guildConfig.upsert({
      where: { guildId: guild.id },
      update: { channelIds, categoryIds },
      create: {
        guildId: guild.id,
        channelIds,
        categoryIds,
        roleIds: {},
        panelMessageIds: {},
        settings: {},
      },
    });

    const embed = new EmbedBuilder()
      .setTitle('✅ Waitlist Channels Created & Configured!')
      .setDescription(`Successfully configured waitlist channels for all **${MODE_LIST.length} gamemodes** in **${guild.name}**!`)
      .addFields(
        { name: '➕ Created New', value: `\`${createdCount}\` channels`, inline: true },
        { name: '✔️ Existing Configured', value: `\`${existingCount}\` channels`, inline: true },
        { name: '📁 Category', value: waitlistCategory ? `<#${waitlistCategory.id}>` : '`WAITLISTS`', inline: true }
      )
      .setColor(COLORS.SUCCESS)
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
