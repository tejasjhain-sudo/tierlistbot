import {
  Guild,
  TextChannel,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalSubmitInteraction,
  ButtonInteraction,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import prisma from '../database/prisma';
import { COLORS } from '../config/constants';
import { setTicketPermissions } from './roleService';

// ─── Send Support Ticket Panel ────────────────────────────────────────────────
export async function sendSupportPanel(guild: Guild, targetChannel: TextChannel): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle('🛠️ RearMC Server Support')
    .setDescription(
      `Need assistance from the RearMC Support Team?\n\n` +
      `• **General Queries & Help**\n` +
      `• **Tier Rank Verification Issues**\n` +
      `• **Bug Reports & Feedback**\n\n` +
      `Click **Request Support** below to open a private ticket!`
    )
    .setColor(COLORS.PRIMARY)
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('request_support_prompt')
      .setLabel('🛠️ Request Support')
      .setStyle(ButtonStyle.Primary)
  );

  await targetChannel.send({ embeds: [embed], components: [row] });
}

// ─── Show Support Ticket Modal ────────────────────────────────────────────────
export async function showSupportTicketModal(interaction: ButtonInteraction): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId('submit_support_ticket_modal')
    .setTitle('Open Support Ticket');

  const subjectInput = new TextInputBuilder()
    .setCustomId('support_subject')
    .setLabel('Subject / Reason')
    .setPlaceholder('e.g. Verification Help, Rank Issue, General Question...')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const descInput = new TextInputBuilder()
    .setCustomId('support_description')
    .setLabel('Describe your issue in detail')
    .setPlaceholder('Provide as much detail as possible so our team can help...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(subjectInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(descInput)
  );

  await interaction.showModal(modal);
}

// ─── Create Support Ticket Channel ────────────────────────────────────────────
export async function handleSupportTicketSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });

  const subject = interaction.fields.getTextInputValue('support_subject');
  const description = interaction.fields.getTextInputValue('support_description');

  const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
  const categoryIds = (guildConfig?.categoryIds as Record<string, any>) ?? {};

  let supportCategory = interaction.guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && (c.id === categoryIds.support || c.name.toUpperCase().includes('SUPPORT'))
  ) as any;

  if (!supportCategory) {
    supportCategory = await interaction.guild.channels.create({
      name: '🛠️ SUPPORT TICKETS',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [{ id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }],
    });

    categoryIds.support = supportCategory.id;
    await prisma.guildConfig.update({
      where: { guildId: interaction.guild.id },
      data: { categoryIds: categoryIds as any },
    });
  }

  const channelName = `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

  const channel = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: supportCategory.id,
  });

  await setTicketPermissions(channel, interaction.user.id, interaction.guild.ownerId);

  const embed = new EmbedBuilder()
    .setTitle(`🛠️ Support Ticket — ${subject}`)
    .setDescription(
      `Welcome <@${interaction.user.id}>!\n\n` +
      `**Subject:** \`${subject}\`\n\n` +
      `**Issue Details:**\n${description}\n\n` +
      `A member of the Support Team will be with you shortly.`
    )
    .setColor(COLORS.PRIMARY)
    .setTimestamp();

  const closeBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`close_support_ticket_${interaction.user.id}`)
      .setLabel('🔒 Close Ticket')
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [closeBtn] });

  await interaction.editReply({
    content: `✅ Created support ticket in <#${channel.id}>!`,
  });
}
