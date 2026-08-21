import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import prisma from '../../database/prisma';
import { createVerificationSession, pendingInteractions } from '../../services/verificationService';
import { COLORS } from '../../config/constants';
import { getPlayerHeadUrl } from '../../services/minecraftService';

export default {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Link your Discord account to your Minecraft account.'),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const discordId = interaction.user.id;

    try {
      // 1. Check if user is already verified
      const existingPlayer = await prisma.player.findUnique({
        where: { discordId },
      });

      if (existingPlayer && existingPlayer.minecraftUuid) {
        const embed = new EmbedBuilder()
          .setTitle('✅ Already Verified')
          .setThumbnail(getPlayerHeadUrl(existingPlayer.minecraftUsername))
          .setDescription(
            `Your Discord account is already linked to your Minecraft account.\n\n` +
            `🎮 **Minecraft IGN:** \`${existingPlayer.minecraftUsername}\`\n` +
            `🆔 **Minecraft UUID:** \`${existingPlayer.minecraftUuid}\`\n` +
            `🌍 **Region:** \`${existingPlayer.region}\`\n\n` +
            `*If you need to change your linked account, contact a server administrator.*`
          )
          .setColor(COLORS.SUCCESS)
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      // Ping the MC server to see if it's online
      let isOnline = false;
      const verifyServerIP = (process.env.MINECRAFT_VERIFY_SERVER || 'verify.rearmc.fun:2003').split(':')[0];
      const verifyServerPort = parseInt((process.env.MINECRAFT_VERIFY_SERVER || 'verify.rearmc.fun:2003').split(':')[1] || '25565', 10);
      
      isOnline = await new Promise((resolve) => {
        const util = require('minecraft-server-util');
        util.status(verifyServerIP, verifyServerPort, { timeout: 2000 })
          .then(() => resolve(true))
          .catch(() => resolve(false));
      });

      if (!isOnline) {
        if (existingPlayer) {
          const { fetchMinecraftProfile } = require('../../services/minecraftService');
          const profile = await fetchMinecraftProfile(existingPlayer.minecraftUsername);
          const uuid = profile?.id ?? 'offline-uuid-' + Date.now();
          
          await prisma.player.update({
            where: { discordId },
            data: { minecraftUuid: uuid }
          });
          
          const successEmbed = new EmbedBuilder()
            .setTitle('✅ Verified (Offline Mode)')
            .setDescription(`The Minecraft server is currently offline, so we bypassed in-game verification.\nYour account is now linked to **${existingPlayer.minecraftUsername}**!`)
            .setColor(COLORS.SUCCESS);
          return interaction.editReply({ embeds: [successEmbed] });
        } else {
          const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Server Offline')
            .setDescription(`The Minecraft server is currently offline. Please use the **Verify Account** button in the registration channel to manually link your account!`)
            .setColor(COLORS.DANGER);
          return interaction.editReply({ embeds: [errorEmbed] });
        }
      }

      // 2. Generate new verification token
      const session = await createVerificationSession(discordId);
      const verifyServer = process.env.MINECRAFT_VERIFY_SERVER || 'verify.rearmc.fun:2003';

      // Store active interaction for live editing when verification completes
      pendingInteractions.set(session.token, interaction);

      const embed = new EmbedBuilder()
        .setTitle('🔐 Minecraft Account Verification')
        .setDescription(
          `To link your Minecraft account to Discord, follow these steps:\n\n` +
          `1️⃣ Join the verification server:\n\`${verifyServer}\`\n\n` +
          `2️⃣ In Minecraft chat, type:\n\`/verify ${session.token}\`\n\n` +
          `**Verification Token:** \`${session.token}\`\n` +
          `**Status:** ⏳ Waiting for connection...\n\n` +
          `⏰ *Verification token expires in 10 minutes.*`
        )
        .setColor(COLORS.PRIMARY)
        .setFooter({ text: 'RearMC Verification System' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in /verify command:', error);
      const embed = new EmbedBuilder()
        .setDescription('❌ An unexpected error occurred while starting verification.')
        .setColor(COLORS.DANGER);
      return interaction.editReply({ embeds: [embed] });
    }
  },
};
