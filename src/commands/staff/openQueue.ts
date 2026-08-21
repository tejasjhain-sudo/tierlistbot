import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { Mode, Region } from '../../config/constants';
import { startTesting, stopTesting } from '../../services/testerService';
import { COLORS, MODES } from '../../config/constants';
import prisma from '../../database/prisma';

export default {
  data: new SlashCommandBuilder()
    .setName('open-queue')
    .setDescription('Open the waitlist testing queue for a gamemode.')
    .addStringOption(opt =>
      opt.setName('mode').setDescription('Gamemode to open').setRequired(true)
        .addChoices(
          { name: 'Sword', value: 'sword' },
          { name: 'Axe', value: 'axe' },
          { name: 'Netherite Pot', value: 'nethpot' },
          { name: 'Diamond Pot', value: 'dpot' },
          { name: 'UHC', value: 'uhc' },
          { name: 'SMP', value: 'smp' },
          { name: 'Crystal', value: 'crystal' },
          { name: 'Mace', value: 'mace' },
        )
    )
    .addStringOption(opt =>
      opt.setName('region').setDescription('Filter queue by region').setRequired(false)
        .addChoices(
          { name: 'All Regions', value: 'all' },
          { name: 'Asia (AS)', value: 'AS' },
          { name: 'Europe (EU)', value: 'EU' },
          { name: 'North America (NA)', value: 'NA' },
          { name: 'Australia (AU)', value: 'AU' },
          { name: 'South America (SA)', value: 'SA' },
          { name: 'Middle East (ME)', value: 'ME' },
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) {
      return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const mode = interaction.options.getString('mode', true) as Mode;
    const region = (interaction.options.getString('region') as Region | 'all') || 'all';

    // Verify tester / staff permissions
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdminPerm = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    const isAdmin = isOwner || isAdminPerm || (roleIds.tierAdmin ? (member?.roles.cache.has(roleIds.tierAdmin) ?? false) : false);
    const isStaff = isAdmin || (roleIds.tierManager ? (member?.roles.cache.has(roleIds.tierManager) ?? false) : false);

    const modeTesterRoleId = roleIds.testers?.[mode];
    const hasTesterRole = modeTesterRoleId && member?.roles.cache.has(modeTesterRoleId);
    const hasNamedRole = member?.roles.cache.some(r => r.name.toLowerCase() === `${MODES[mode].toLowerCase()} tester`);

    if (!isStaff && !hasTesterRole && !hasNamedRole) {
      return interaction.editReply({
        content: `❌ You do not have permission to open the **${MODES[mode]}** queue. You must be a **${MODES[mode]} Tester** or Tier Manager.`,
      });
    }

    const result = await startTesting(interaction.guild, interaction.user.id, mode, region);

    const embed = new EmbedBuilder()
      .setTitle(result.success ? '🟢 Queue Opened Successfully' : '❌ Could Not Open Queue')
      .setDescription(result.message)
      .setColor(result.success ? COLORS.SUCCESS : COLORS.DANGER)
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
