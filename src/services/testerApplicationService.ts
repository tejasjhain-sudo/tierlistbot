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

// ─── Send Tester Application Panel ───────────────────────────────────────────
export async function sendTesterApplicationPanel(guild: Guild, targetChannel: TextChannel): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle('📝 Tier Tester Applications')
    .setDescription(
      `Want to join the Arix Tierlist Staff Team as an official **Tier Tester**?\n\n` +
      `• **Requirements:** Authentic gameplay knowledge, activity, and objective testing.\n` +
      `• **Responsibilities:** Evaluate players in queue, issue accurate tiers, and update test logs.\n\n` +
      `Click **Apply for Tester** below to submit your application!`
    )
    .setColor(COLORS.PRIMARY)
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('apply_tester_prompt')
      .setLabel('📝 Apply for Tester')
      .setStyle(ButtonStyle.Primary)
  );

  await targetChannel.send({ embeds: [embed], components: [row] });
}

// ─── Open Application Modal ──────────────────────────────────────────────────
export async function showTesterApplicationModal(interaction: ButtonInteraction): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId('submit_tester_app_modal')
    .setTitle('Tier Tester Application');

  const modesInput = new TextInputBuilder()
    .setCustomId('app_modes')
    .setLabel('Which gamemodes do you want to test?')
    .setPlaceholder('e.g. Sword, Axe, Netherite Pot, Crystal...')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const expInput = new TextInputBuilder()
    .setCustomId('app_experience')
    .setLabel('Your PvP / Tier Testing Experience')
    .setPlaceholder('Describe your experience in tier testing or competitive PvP...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  const availInput = new TextInputBuilder()
    .setCustomId('app_availability')
    .setLabel('Weekly Availability (Hours / Timezone)')
    .setPlaceholder('e.g. 15 hours/week, EST timezone...')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const whyInput = new TextInputBuilder()
    .setCustomId('app_why')
    .setLabel('Why should we accept your application?')
    .setPlaceholder('Tell us why you would be a great addition to the team...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(modesInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(expInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(availInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(whyInput)
  );

  await interaction.showModal(modal);
}

// ─── Process Application Submission ──────────────────────────────────────────
export async function handleTesterApplicationSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });

  const modes = interaction.fields.getTextInputValue('app_modes');
  const experience = interaction.fields.getTextInputValue('app_experience');
  const availability = interaction.fields.getTextInputValue('app_availability');
  const why = interaction.fields.getTextInputValue('app_why');

  const player = await prisma.player.findUnique({ where: { discordId: interaction.user.id } });
  const mcUsername = player?.minecraftUsername ?? interaction.user.username;

  // Find or create #tester-applications channel
  let appChannel = interaction.guild.channels.cache.find(c => c.name === 'tester-applications') as TextChannel | undefined;

  if (!appChannel) {
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};

    const overwrites = [{ id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];
    if (roleIds.tierAdmin) overwrites.push({ id: roleIds.tierAdmin, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] } as any);
    if (roleIds.tierManager) overwrites.push({ id: roleIds.tierManager, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] } as any);

    appChannel = await interaction.guild.channels.create({
      name: 'tester-applications',
      type: ChannelType.GuildText,
      permissionOverwrites: overwrites,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(`📋 New Tester Application — ${interaction.user.tag}`)
    .setThumbnail(interaction.user.displayAvatarURL())
    .addFields(
      { name: 'Applicant', value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
      { name: 'Minecraft IGN', value: `\`${mcUsername}\``, inline: true },
      { name: 'Requested Modes', value: modes, inline: false },
      { name: 'PvP & Testing Experience', value: experience, inline: false },
      { name: 'Availability', value: availability, inline: true },
      { name: 'Why Accept?', value: why, inline: false }
    )
    .setColor(COLORS.PRIMARY)
    .setTimestamp();

  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`accept_tester_app_${interaction.user.id}`)
      .setLabel('✅ Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`deny_tester_app_${interaction.user.id}`)
      .setLabel('❌ Deny')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`delete_tester_app_${interaction.user.id}`)
      .setLabel('🗑️ Delete')
      .setStyle(ButtonStyle.Secondary)
  );

  await appChannel.send({ embeds: [embed], components: [actions] });

  await interaction.editReply({
    content: '✅ Your **Tier Tester Application** has been submitted! Our staff team will review it shortly.',
  });
}
