import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import { COLORS } from '../../config/constants';
import prisma from '../../database/prisma';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || 'https://gioxgsgiihqtbtbljnil.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_nQlLJaj1mr2XdhA7YZFl2w_0_hGf_57';
const supabase = createClient(supabaseUrl, supabaseKey);

export default {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Link your Discord account to your Minecraft IGN using a code.')
    .addStringOption(option =>
      option
        .setName('code')
        .setDescription('The registration code generated on the website')
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    // We defer reply so we have time to query Supabase
    await interaction.deferReply({ ephemeral: true });

    const code = interaction.options.getString('code', true).toUpperCase();

    try {
      // Query the profile_claims table
      const { data: claims, error: fetchError } = await supabase
        .from('profile_claims')
        .select('*')
        .eq('code', code);

      // If no code is found
      if (fetchError || !claims || claims.length === 0) {
        const embed = new EmbedBuilder()
          .setDescription('❌ Invalid code! Please generate a new code on the website.')
          .setColor(COLORS.DANGER);
        return interaction.editReply({ embeds: [embed] });
      }

      const claim = claims[0];

      // If already verified
      if (claim.status === 'verified') {
        const embed = new EmbedBuilder()
          .setDescription('❌ This code has already been claimed!')
          .setColor(COLORS.DANGER);
        return interaction.editReply({ embeds: [embed] });
      }

      // If status is not exactly pending (and not verified)
      if (claim.status !== 'pending') {
        const embed = new EmbedBuilder()
          .setDescription('❌ Invalid code! Please generate a new code on the website.')
          .setColor(COLORS.DANGER);
        return interaction.editReply({ embeds: [embed] });
      }

      const player = await prisma.player.findUnique({
        where: { discordId: interaction.user.id }
      });

      if (!player || player.minecraftUsernameLower !== claim.ign.toLowerCase()) {
        const embed = new EmbedBuilder()
          .setDescription('❌ You do not own this Minecraft account!')
          .setColor(COLORS.DANGER);
        return interaction.editReply({ embeds: [embed] });
      }

      // Update the row
      const { error: updateError } = await supabase
        .from('profile_claims')
        .update({
          status: 'verified'
        })
        .eq('code', code);

      if (updateError) {
        console.error('Failed to update Supabase:', updateError);
        const embed = new EmbedBuilder()
          .setDescription(`❌ An error occurred while updating the database:\n\`\`\`json\n${JSON.stringify(updateError, null, 2)}\n\`\`\``)
          .setColor(COLORS.DANGER);
        return interaction.editReply({ embeds: [embed] });
      }

      // Try to assign the 'Verified Player' role
      if (interaction.guild) {
        const role = interaction.guild.roles.cache.find(r => r.name === 'Verified Player');
        if (role) {
          try {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            await member.roles.add(role);
          } catch (err) {
            console.error('Failed to add Verified Player role:', err);
          }
        } else {
          console.warn('Verified Player role not found in the server.');
        }
      }

      // Success
      const embed = new EmbedBuilder()
        .setDescription(`✅ Successfully linked! Your Discord is now linked to IGN: ${claim.ign}! The website has automatically unlocked your customization menu.`)
        .setColor(COLORS.SUCCESS);

      await interaction.editReply({ embeds: [embed] });

      // Log registration
      if (interaction.guild) {
        try {
          const { logToChannel } = require('../../utils/logger');
          const logEmbed = new EmbedBuilder()
            .setTitle('👤 New Player Verified (Website/Supabase)')
            .setDescription(`<@${interaction.user.id}> has linked their account to **${claim.ign}**.`)
            .setColor(COLORS.SUCCESS)
            .setTimestamp();
          await logToChannel(interaction.client, interaction.guildId, logEmbed);
        } catch (e) {
          console.error('Logger error:', e);
        }
      }
      return;
      
    } catch (error) {
      console.error('Error in register command:', error);
      const embed = new EmbedBuilder()
        .setDescription('❌ An unexpected error occurred. Please try again later.')
        .setColor(COLORS.DANGER);
      return interaction.editReply({ embeds: [embed] });
    }
  },
};
