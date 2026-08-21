import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from '../../config';
import prisma from '../../database/prisma';

export default {
  data: new SlashCommandBuilder()
    .setName('backup-auth')
    .setDescription('Authorize the bot to backup your account and auto-join you to new servers if needed.'),

  async execute(interaction: ChatInputCommandInteraction) {
    const player = await prisma.player.findUnique({ where: { discordId: interaction.user.id } });

    if (!player) {
      return interaction.reply({
        content: '❌ You must register your Minecraft account first before setting up backups.',
        ephemeral: true,
      });
    }

    const redirectUri = `${config.publicApiUrl}/api/auth/callback`;
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${config.discordClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify%20guilds.join`;

    const embed = new EmbedBuilder()
      .setTitle('🔒 Backup Authorization')
      .setDescription('Click the button below to authorize the bot. This allows the bot to securely backup your roles and automatically pull you into the new server if this one is ever deleted.')
      .setColor(0x3498DB);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Authorize Backup')
        .setStyle(ButtonStyle.Link)
        .setURL(authUrl)
    );

    await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true,
    });
  },
};
