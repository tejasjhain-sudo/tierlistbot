import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import prisma from '../../database/prisma';

const data = new SlashCommandBuilder()
  .setName('reset-cooldown')
  .setDescription('Reset the 3-day IGN update cooldown for a player.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption(option => 
    option.setName('user')
      .setDescription('The Discord user to reset')
      .setRequired(true));

async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const user = interaction.options.getUser('user', true);

  const player = await prisma.player.findUnique({ where: { discordId: user.id } });

  if (!player) {
    return interaction.editReply('❌ That user is not registered.');
  }

  await prisma.player.update({
    where: { discordId: user.id },
    data: { lastIgnUpdateAt: null },
  });

  await interaction.editReply(`✅ Successfully reset the IGN update cooldown for <@${user.id}>.`);
}
export default { data, execute };
