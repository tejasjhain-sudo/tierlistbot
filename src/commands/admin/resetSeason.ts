import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import prisma from '../../database/prisma';
import { Prisma } from '@prisma/client';
import { COLORS, TIERS } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('reset-season')
    .setDescription('[Admin] Reset all player tiers to Unranked and start a fresh new season.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption(opt =>
      opt
        .setName('remove_discord_tier_roles')
        .setDescription('Whether to also strip tier roles (HT1-LT5) from members in Discord')
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Must be used inside a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: false });

    try {
      // 1. Reset all PlayerTier records in Supabase
      const updatedTiers = await prisma.playerTier.updateMany({
        data: {
          currentTier: 'Unranked',
          previousTier: null,
          lastTesterDiscordId: null,
          lastTestedAt: null,
        },
      });

      // 2. Clear old TierHistory records
      const deletedHistory = await prisma.tierHistory.deleteMany({});

      // 3. Clear old TestSessions
      const deletedSessions = await prisma.testSession.deleteMany({});

      // 4. Reset waitlist cooldowns
      await prisma.player.updateMany({
        data: {
          waitlistRoleCooldowns: Prisma.DbNull,
        },
      });

      // 5. Remove Discord tier roles if requested
      const removeDiscordRoles = interaction.options.getBoolean('remove_discord_tier_roles') ?? false;
      let strippedRolesCount = 0;

      if (removeDiscordRoles) {
        const guild = interaction.guild;
        const tierRoles = guild.roles.cache.filter(role => {
          const name = role.name;
          return TIERS.some(t => name.endsWith(` ${t}`));
        });

        await guild.members.fetch().catch(() => {});

        for (const [, member] of guild.members.cache) {
          if (member.user.bot) continue;
          const rolesToRemove = member.roles.cache.filter(r => tierRoles.has(r.id));
          if (rolesToRemove.size > 0) {
            try {
              await member.roles.remove(rolesToRemove, 'New Season Tier Reset');
              strippedRolesCount++;
            } catch {}
          }
        }
      }

      const embed = new EmbedBuilder()
        .setTitle('🏆 New Season Reset Complete!')
        .setDescription(
          `All ranks, history, and test logs have been reset for the **New Season**!\n\n` +
          `• **Player Tiers Reset**: \`${updatedTiers.count}\` tier records set to \`Unranked\` (0 previous rank)\n` +
          `• **History Logs Cleared**: \`${deletedHistory.count}\` records\n` +
          `• **Test Sessions Cleared**: \`${deletedSessions.count}\` sessions\n` +
          `• **Cooldowns**: Reset for all registered players\n` +
          (removeDiscordRoles ? `• **Discord Roles Stripped**: Removed tier roles from \`${strippedRolesCount}\` members\n` : '') +
          `\n✨ Players keep their registration & backup verification, ready for new testing!`
        )
        .setColor(COLORS.SUCCESS)
        .setFooter({ text: 'RearMC Season Management' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (e: any) {
      console.error('Season reset error:', e);
      return interaction.editReply({ content: `❌ Error during season reset: ${e.message}` });
    }
  },
};
