import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  OverwriteType,
  OverwriteResolvable,
} from 'discord.js';
import prisma from '../../database/prisma';
import { COLORS } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('fix-permissions')
    .setDescription('[Admin] Fix and lock all channel permissions so unverified members only see #verify.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Must be used in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: false });

    const guild = interaction.guild;
    const roles = await guild.roles.fetch();

    let adminRole = roles.find(r => r.name === 'Tier Admin');
    let managerRole = roles.find(r => r.name === 'Tier Manager');
    let registeredRole = roles.find(r => r.name === 'Registered');
    let authorisedRole = roles.find(r => r.name.toLowerCase() === 'authorised' || r.name.toLowerCase() === 'verified');
    let unauthorisedRole = roles.find(r => r.name.toLowerCase() === 'unauthorised' || r.name.toLowerCase() === 'unverified');

    if (!unauthorisedRole) {
      unauthorisedRole = await guild.roles.create({
        name: 'Unauthorised',
        color: '#7F8C8D',
        reason: 'Auto-created by fix-permissions',
      });
    }
    if (!authorisedRole) {
      authorisedRole = await guild.roles.create({
        name: 'Authorised',
        color: '#2ECC71',
        hoist: true,
        reason: 'Auto-created by fix-permissions',
      });
    }

    const staffRoles = roles.filter(r =>
      r.name.includes('Tester') || r.name.includes('Admin') || r.name.includes('Manager')
    );

    const channels = await guild.channels.fetch();

    for (const [, ch] of channels) {
      if (!ch) continue;

      // 1. Verification Category / Channel
      if (ch.name.toLowerCase().includes('verification') || ch.name.includes('verify')) {
        try {
          await ch.permissionOverwrites.set([
            {
              id: guild.roles.everyone.id,
              type: OverwriteType.Role,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
              deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions],
            },
            {
              id: unauthorisedRole.id,
              type: OverwriteType.Role,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
              deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions],
            },
            {
              id: authorisedRole.id,
              type: OverwriteType.Role,
              deny: [PermissionFlagsBits.ViewChannel],
            },
            ...(registeredRole ? [{
              id: registeredRole.id,
              type: OverwriteType.Role,
              deny: [PermissionFlagsBits.ViewChannel],
            }] : []),
            ...(adminRole ? [{
              id: adminRole.id,
              type: OverwriteType.Role,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
            }] : []),
          ]);
        } catch {}
        continue;
      }

      // 2. Private Staff logs / Private Tester Hub
      if (ch.name.includes('Admin') || ch.name.includes('logs') || ch.name.includes('Tester') || ch.name.includes('TOURNAMENT REVIEW')) {
        continue;
      }

      // 3. Public Categories
      if (ch.type === ChannelType.GuildCategory) {
        try {
          const catOverwrites: OverwriteResolvable[] = [
            {
              id: guild.roles.everyone.id,
              type: OverwriteType.Role,
              deny: [PermissionFlagsBits.ViewChannel],
            },
            {
              id: unauthorisedRole.id,
              type: OverwriteType.Role,
              deny: [PermissionFlagsBits.ViewChannel],
            },
            {
              id: authorisedRole.id,
              type: OverwriteType.Role,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            },
            ...(registeredRole ? [{
              id: registeredRole.id,
              type: OverwriteType.Role,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            }] : []),
          ];

          for (const [, sr] of staffRoles) {
            catOverwrites.push({
              id: sr.id,
              type: OverwriteType.Role,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
            });
          }

          await ch.permissionOverwrites.set(catOverwrites);
        } catch {}
      } else if (ch.isTextBased() || ch.isVoiceBased()) {
        try {
          await ch.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false });
          await ch.permissionOverwrites.edit(unauthorisedRole.id, { ViewChannel: false });
          await ch.permissionOverwrites.edit(authorisedRole.id, { ViewChannel: true, ReadMessageHistory: true });
          if (registeredRole) {
            await ch.permissionOverwrites.edit(registeredRole.id, { ViewChannel: true, ReadMessageHistory: true });
          }
        } catch {}
      }
    }

    // Save roles to GuildConfig
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};
    roleIds.unauthorised = unauthorisedRole.id;
    roleIds.authorised = authorisedRole.id;
    if (registeredRole) roleIds.registered = registeredRole.id;

    await prisma.guildConfig.upsert({
      where: { guildId: guild.id },
      update: { roleIds },
      create: {
        guildId: guild.id,
        roleIds,
      },
    });

    const embed = new EmbedBuilder()
      .setTitle('🔒 Permissions Fixed & Verified')
      .setDescription(
        `All server channel permissions have been synchronized:\n\n` +
        `• **Unverified Members**: Assigned <@&${unauthorisedRole.id}> and can **only** see \`🔒・verify\`\n` +
        `• **Verified Members**: Assigned <@&${authorisedRole.id}> and can see the entire server\n` +
        `• **Categories Secured**: Locked from \`@everyone\` and \`Unauthorised\``
      )
      .setColor(COLORS.SUCCESS)
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
