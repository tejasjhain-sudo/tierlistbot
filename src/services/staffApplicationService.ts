import {
  StringSelectMenuInteraction,
  TextChannel,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Message,
  OverwriteResolvable,
  ButtonInteraction,
} from 'discord.js';
import prisma from '../database/prisma';
import { COLORS } from '../config/constants';

export const QUESTIONS = [
  "What is your age?",
  "What is your Minecraft IGN (In-Game Name)?",
  "What is your timezone/region?",
  "How many hours per week can you contribute to RearMC?",
  "Do you have a working microphone and the ability to record video? (Yes/No)",
  "Why do you want to join the RearMC Staff Team?",
  "Do you have any previous staff experience? (If yes, please describe)",
  "How would you handle a situation where a player is accused of hacking, but there is no staff online?",
  "Why should we choose you over other applicants?",
  "Do you agree to follow all staff guidelines and rules? (Yes/No)"
];

// Helper to check if a user is staff
async function isStaffMember(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.guild) return false;
  const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
  const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

  const isOwner = interaction.guild.ownerId === interaction.user.id;
  const isAdminPerm = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
  
  return isOwner || isAdminPerm 
    || (roleIds.tierAdmin && member?.roles.cache.has(roleIds.tierAdmin))
    || (roleIds.tierManager && member?.roles.cache.has(roleIds.tierManager));
}

// Helper to get or create staff-logs channel
async function getOrCreateStaffLogsChannel(guild: any): Promise<TextChannel | null> {
  let logChannel = guild.channels.cache.find((c: any) => c.name === 'staff-logs' && c.type === ChannelType.GuildText) as TextChannel | undefined;
  if (!logChannel) {
    try {
      logChannel = await guild.channels.create({
        name: 'staff-logs',
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
        ],
      });
    } catch (e) {
      console.error('Failed to create staff-logs channel:', e);
      return null;
    }
  }
  return logChannel || null;
}

// ─── Start Staff Application ──────────────────────────────────────────────────
export async function startStaffApplication(interaction: StringSelectMenuInteraction): Promise<any> {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });

  const discordId = interaction.user.id;

  // Check if they already have an active application
  const existing = await prisma.staffApplication.findUnique({
    where: { discordId },
  });

  if (existing && (existing.status === 'APPLYING' || existing.status === 'UNDER_REVIEW')) {
    return interaction.editReply({ content: '❌ You already have an active staff application in progress or under review.' });
  }

  // Create category "STAFF APPLICATIONS" if not exists
  let category = interaction.guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name.toUpperCase() === 'STAFF APPLICATIONS'
  );
  if (!category) {
    try {
      category = await interaction.guild.channels.create({
        name: '📝 STAFF APPLICATIONS',
        type: ChannelType.GuildCategory,
        permissionOverwrites: [{ id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }],
      });
    } catch {}
  }

  const channelName = `apply-${interaction.user.username.toLowerCase()}`;
  let applyChannel: TextChannel;

  try {
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};

    const permissionOverwrites: OverwriteResolvable[] = [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ];

    if (roleIds.tierManager) {
      permissionOverwrites.push({ id: roleIds.tierManager, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
    }
    if (roleIds.tierAdmin) {
      permissionOverwrites.push({ id: roleIds.tierAdmin, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
    }

    applyChannel = await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category ? category.id : undefined,
      permissionOverwrites,
    });
  } catch (err) {
    console.error('Failed to create apply channel:', err);
    return interaction.editReply({ content: '❌ Failed to create application channel. Please contact an Admin.' });
  }

  // Save to DB
  await prisma.staffApplication.upsert({
    where: { discordId },
    update: {
      guildId: interaction.guild.id,
      channelId: applyChannel.id,
      answers: JSON.stringify([]),
      currentStep: 0,
      status: 'APPLYING',
    },
    create: {
      discordId,
      guildId: interaction.guild.id,
      channelId: applyChannel.id,
      answers: JSON.stringify([]),
      currentStep: 0,
      status: 'APPLYING',
    },
  });

  // Post Welcome and Question 1
  const embed = new EmbedBuilder()
    .setTitle('📝 Staff Application')
    .setDescription(
      `Welcome to your staff application ticket, <@${discordId}>!\n\n` +
      `Please answer the following 10 questions one by one. Take your time to answer professionally.\n\n` +
      `**Question 1:** ${QUESTIONS[0]}`
    )
    .setColor(COLORS.PRIMARY)
    .setTimestamp();

  await applyChannel.send({ content: `<@${discordId}>`, embeds: [embed] });

  return interaction.editReply({ content: `📝 Your staff application channel has been created: <#${applyChannel.id}>. Please head there to answer the questions.` });
}

// ─── Handle Message Event in Apply Channel ──────────────────────────────────────
export async function handleStaffApplyMessage(message: Message): Promise<any> {
  if (message.author.bot || !message.guild) return;

  const app = await prisma.staffApplication.findFirst({
    where: { channelId: message.channel.id, status: 'APPLYING' },
  });

  if (!app || app.discordId !== message.author.id) return;

  const currentAnswers = JSON.parse(app.answers as string) as string[];
  currentAnswers.push(message.content);

  const nextStep = app.currentStep + 1;

  if (nextStep < QUESTIONS.length) {
    // Save state and ask next question
    await prisma.staffApplication.update({
      where: { discordId: app.discordId },
      data: {
        answers: JSON.stringify(currentAnswers),
        currentStep: nextStep,
      },
    });

    const embed = new EmbedBuilder()
      .setDescription(`**Question ${nextStep + 1}:** ${QUESTIONS[nextStep]}`)
      .setColor(COLORS.PRIMARY);

    await (message.channel as TextChannel).send({ embeds: [embed] });
  } else {
    // Finished all questions!
    await prisma.staffApplication.update({
      where: { discordId: app.discordId },
      data: {
        answers: JSON.stringify(currentAnswers),
        currentStep: nextStep,
        status: 'UNDER_REVIEW',
      },
    });

    const embed = new EmbedBuilder()
      .setTitle('🎉 Application Completed!')
      .setDescription(
        'Thank you! Your staff application has been successfully submitted and is now **under review**.\n\n' +
        'This channel will be automatically deleted in 5 seconds.'
      )
      .setColor(COLORS.SUCCESS)
      .setTimestamp();

    await (message.channel as TextChannel).send({ embeds: [embed] });

    // Send completed application to staff logs
    const logChannel = await getOrCreateStaffLogsChannel(message.guild);
    if (logChannel) {
      const answersList = QUESTIONS.map((q, idx) => `**Q${idx + 1}: ${q}**\n*A: ${currentAnswers[idx]}*`).join('\n\n');

      const logEmbed = new EmbedBuilder()
        .setTitle(`📝 New Staff Application — ${message.author.username}`)
        .setDescription(
          `**Applicant:** <@${app.discordId}> (${message.author.tag})\n` +
          `**User ID:** \`${app.discordId}\`\n\n` +
          `---` +
          `\n\n${answersList}`
        )
        .setColor(COLORS.PRIMARY)
        .setTimestamp();

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`staff_app_accept_${app.discordId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`staff_app_decline_${app.discordId}`).setLabel('Decline').setStyle(ButtonStyle.Danger)
      );

      await logChannel.send({ embeds: [logEmbed], components: [row] });
    }

    // Queue channel deletion in 5 seconds
    setTimeout(() => {
      message.channel.delete().catch(() => {});
    }, 5000);
  }
}

// ─── Staff Button: Accept Application ──────────────────────────────────────────
export async function handleStaffAppAccept(interaction: ButtonInteraction, applicantId: string): Promise<any> {
  await interaction.deferReply({ ephemeral: true });

  if (!(await isStaffMember(interaction))) {
    return interaction.editReply({ content: '❌ Only staff members can review applications.' });
  }

  const app = await prisma.staffApplication.findUnique({
    where: { discordId: applicantId },
  });

  if (!app) {
    return interaction.editReply({ content: '❌ Application not found in database.' });
  }

  if (app.status !== 'UNDER_REVIEW') {
    return interaction.editReply({ content: `❌ This application is already marked as **${app.status}**.` });
  }

  // Update DB status to ACCEPTED
  await prisma.staffApplication.update({
    where: { discordId: applicantId },
    data: { status: 'ACCEPTED' },
  });

  // Create Category "STAFF INTERVIEWS" if not exists
  let category = interaction.guild!.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name.toUpperCase() === 'STAFF INTERVIEWS'
  );
  if (!category) {
    try {
      category = await interaction.guild!.channels.create({
        name: '👥 STAFF INTERVIEWS',
        type: ChannelType.GuildCategory,
        permissionOverwrites: [{ id: interaction.guild!.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }],
      });
    } catch {}
  }

  const applicant = await interaction.client.users.fetch(applicantId).catch(() => null);
  const channelName = `interview-${applicant ? applicant.username.toLowerCase() : applicantId}`;
  let interviewChannel: TextChannel;

  try {
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild!.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};

    const permissionOverwrites: OverwriteResolvable[] = [
      { id: interaction.guild!.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: applicantId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ];

    if (roleIds.tierManager) {
      permissionOverwrites.push({ id: roleIds.tierManager, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
    }
    if (roleIds.tierAdmin) {
      permissionOverwrites.push({ id: roleIds.tierAdmin, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
    }

    interviewChannel = await interaction.guild!.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category ? category.id : undefined,
      permissionOverwrites,
    });
  } catch (err) {
    console.error('Failed to create interview channel:', err);
    return interaction.editReply({ content: '❌ Failed to create interview channel. Please create one manually.' });
  }

  // DM the user
  try {
    const dmEmbed = new EmbedBuilder()
      .setTitle('🎉 Staff Application Accepted!')
      .setDescription(`Congratulations! Your staff application on **${interaction.guild!.name}** has been accepted. An interview channel has been created: <#${interviewChannel.id}>.`)
      .setColor(COLORS.SUCCESS)
      .setTimestamp();
    await applicant?.send({ embeds: [dmEmbed] });
  } catch {}

  // Post Welcome message in interview channel
  const welcomeEmbed = new EmbedBuilder()
    .setTitle('👥 Staff Interview')
    .setDescription(
      `Welcome <@${applicantId}> to your staff interview ticket!\n\n` +
      `Staff members will join shortly to conduct the live interview. Please be prepared and wait patiently.`
    )
    .setColor(COLORS.SUCCESS)
    .setTimestamp();

  await interviewChannel.send({ content: `<@${applicantId}>`, embeds: [welcomeEmbed] });

  // Update staff logs embed to disable buttons
  const logEmbed = EmbedBuilder.from(interaction.message.embeds[0])
    .setTitle(`📝 Staff Application — ${applicant ? applicant.username : applicantId} [ACCEPTED]`)
    .setColor(COLORS.SUCCESS);

  await interaction.message.edit({ embeds: [logEmbed], components: [] });

  return interaction.editReply({ content: `✅ Application successfully accepted! Created interview ticket: <#${interviewChannel.id}>` });
}

// ─── Staff Button: Decline Application ──────────────────────────────────────────
export async function handleStaffAppDecline(interaction: ButtonInteraction, applicantId: string): Promise<any> {
  await interaction.deferReply({ ephemeral: true });

  if (!(await isStaffMember(interaction))) {
    return interaction.editReply({ content: '❌ Only staff members can review applications.' });
  }

  const app = await prisma.staffApplication.findUnique({
    where: { discordId: applicantId },
  });

  if (!app) {
    return interaction.editReply({ content: '❌ Application not found in database.' });
  }

  if (app.status !== 'UNDER_REVIEW') {
    return interaction.editReply({ content: `❌ This application is already marked as **${app.status}**.` });
  }

  // Update DB status to DECLINED
  await prisma.staffApplication.update({
    where: { discordId: applicantId },
    data: { status: 'DECLINED' },
  });

  const applicant = await interaction.client.users.fetch(applicantId).catch(() => null);

  // DM the user
  try {
    const dmEmbed = new EmbedBuilder()
      .setTitle('❌ Staff Application Declined')
      .setDescription(`Thank you for applying. Unfortunately, your staff application on **${interaction.guild!.name}** has been declined at this time.`)
      .setColor(COLORS.DANGER)
      .setTimestamp();
    await applicant?.send({ embeds: [dmEmbed] });
  } catch {}

  // Update staff logs embed to disable buttons
  const logEmbed = EmbedBuilder.from(interaction.message.embeds[0])
    .setTitle(`📝 Staff Application — ${applicant ? applicant.username : applicantId} [DECLINED]`)
    .setColor(COLORS.DANGER);

  await interaction.message.edit({ embeds: [logEmbed], components: [] });

  return interaction.editReply({ content: '❌ Application successfully declined.' });
}
