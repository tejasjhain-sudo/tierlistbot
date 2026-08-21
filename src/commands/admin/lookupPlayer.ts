import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import prisma from '../../database/prisma';

const data = new SlashCommandBuilder()
  .setName('lookup')
  .setDescription('Look up a player by Discord user or Minecraft IGN.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addUserOption(option => 
    option.setName('user')
      .setDescription('The Discord user to look up')
      .setRequired(false))
  .addStringOption(option => 
    option.setName('ign')
      .setDescription('The Minecraft IGN to look up')
      .setRequired(false));

async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const user = interaction.options.getUser('user');
  const ign = interaction.options.getString('ign');

  if (!user && !ign) {
    return interaction.editReply('❌ You must provide either a Discord user or a Minecraft IGN.');
  }

  let player;

  if (user) {
    player = await prisma.player.findUnique({ where: { discordId: user.id } });
  } else if (ign) {
    player = await prisma.player.findUnique({ where: { minecraftUsernameLower: ign.toLowerCase() } });
  }

  if (!player) {
    return interaction.editReply('❌ No registered player found with that information.');
  }

  const embed = new EmbedBuilder()
    .setTitle('Player Lookup')
    .setThumbnail(`https://mc-heads.net/avatar/${player.minecraftUsername}/100`)
    .addFields(
      { name: 'Discord User', value: `<@${player.discordId}> (\`${player.discordId}\`)`, inline: true },
      { name: 'Minecraft IGN', value: `\`${player.minecraftUsername}\``, inline: true },
      { name: 'UUID', value: `\`${player.minecraftUuid || 'Unknown'}\``, inline: false },
      { name: 'Region', value: `\`${player.region}\``, inline: true },
      { name: 'Registered At', value: `<t:${Math.floor(player.registeredAt.getTime() / 1000)}:F>`, inline: true }
    )
    .setColor('#00AAFF');

  await interaction.editReply({ embeds: [embed] });
}
export default { data, execute };
