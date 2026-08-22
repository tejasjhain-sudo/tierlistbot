import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
  OverwriteType,
  EmbedBuilder,
} from 'discord.js';
import { sendOrUpdateRegistrationPanel } from '../../services/panelService';
import { COLORS } from '../../config/constants';
import prisma from '../../database/prisma';

export default {
  data: new SlashCommandBuilder()
    .setName('verify-panel')
    .setDescription('[Admin] Create or deploy the Server Verification panel & channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt =>
      opt
        .setName('channel')
        .setDescription('Optional: Specific channel to send panel to (defaults to creating #verify)')
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Must be used inside a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    let targetChannel = interaction.options.getChannel('channel') as TextChannel | null;

    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};

    let unauthorisedRole = roleIds.unauthorised ? guild.roles.cache.get(roleIds.unauthorised) : null;
    let authorisedRole = roleIds.authorised ? guild.roles.cache.get(roleIds.authorised) : null;

    // Ensure Unauthorised role
    if (!unauthorisedRole) {
      unauthorisedRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'unauthorised' || r.name.toLowerCase() === 'unverified') || null;
      if (!unauthorisedRole) {
        unauthorisedRole = await guild.roles.create({
          name: 'Unauthorised',
          color: '#7F8C8D',
          reason: 'Auto-created by /verify-panel',
        });
      }
    }

    // Ensure Authorised role
    if (!authorisedRole) {
      authorisedRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'authorised' || r.name.toLowerCase() === 'verified') || null;
      if (!authorisedRole) {
        authorisedRole = await guild.roles.create({
          name: 'Authorised',
          color: '#2ECC71',
          hoist: true,
          reason: 'Auto-created by /verify-panel',
        });
      }
    }

    // Update roleIds in database
    roleIds.unauthorised = unauthorisedRole.id;
    roleIds.authorised = authorisedRole.id;

    // If no target channel provided, find or create #verify under ' | Verification
    if (!targetChannel) {
      let verifyCat = guild.channels.cache.find(
        c => c.name.toLowerCase().includes('verification') && c.type === ChannelType.GuildCategory
      ) as any;

      if (!verifyCat) {
        verifyCat = await guild.channels.create({
          name: "' | Verification",
          type: ChannelType.GuildCategory,
          permissionOverwrites: [
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
              deny: [PermissionFlagsBits.SendMessages],
            },
            {
              id: authorisedRole.id,
              type: OverwriteType.Role,
              deny: [PermissionFlagsBits.ViewChannel],
            },
          ],
        });
      }

      let ch = guild.channels.cache.find(
        c => c.isTextBased() && (c.name === 'verify' || c.name === '🔒・verify')
      ) as TextChannel | undefined;

      if (!ch) {
        ch = await guild.channels.create({
          name: '🔒・verify',
          type: ChannelType.GuildText,
          parent: verifyCat.id,
          permissionOverwrites: [
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
              deny: [PermissionFlagsBits.SendMessages],
            },
            {
              id: authorisedRole.id,
              type: OverwriteType.Role,
              deny: [PermissionFlagsBits.ViewChannel],
            },
          ],
        });
      }
      targetChannel = ch;
    }

    // Save channel ID to database
    const channelIds = (guildConfig?.channelIds as Record<string, any>) ?? {};
    channelIds.verifyChannel = targetChannel.id;

    await prisma.guildConfig.upsert({
      where: { guildId: guild.id },
      update: { roleIds, channelIds },
      create: {
        guildId: guild.id,
        roleIds,
        channelIds,
      },
    });

    // Deploy verification panel
    await sendOrUpdateRegistrationPanel(guild);

    const embed = new EmbedBuilder()
      .setTitle('✅ Verification Panel Deployed!')
      .setDescription(
        `The **Verification Panel** is now live in <#${targetChannel.id}>!\n\n` +
        `• **Unauthorised Role**: <@&${unauthorisedRole.id}>\n` +
        `• **Authorised Role**: <@&${authorisedRole.id}>\n` +
        `• **Target Channel**: <#${targetChannel.id}>\n\n` +
        `🔒 New members will only see <#${targetChannel.id}> until they click **Verify Account**!`
      )
      .setColor(COLORS.SUCCESS)
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
