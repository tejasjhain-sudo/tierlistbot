import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import { checkGitUpdates, performGitUpdate } from '../../services/updateService';
import { COLORS } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('bot-update')
    .setDescription('[Owner] Check for new updates on GitHub or automatically pull and restart.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt
        .setName('action')
        .setDescription('Action to perform (Default: check)')
        .setRequired(false)
        .addChoices(
          { name: '🔍 Check for Updates', value: 'check' },
          { name: '🚀 Pull Updates & Rebuild Bot', value: 'update' }
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Must be used inside a server.', ephemeral: true });
    }

    if (interaction.guild.ownerId !== interaction.user.id && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Only Server Owners or Administrators can update the bot.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: false });

    const action = interaction.options.getString('action') ?? 'check';

    if (action === 'check') {
      const status = await checkGitUpdates();

      if (status.error) {
        return interaction.editReply({
          content: `⚠️ **Update check could not reach git upstream:**\n\`${status.error}\`\n\n_Note: Make sure your Pterodactyl server has a Git repository configured._`,
        });
      }

      if (status.hasUpdate) {
        const embed = new EmbedBuilder()
          .setTitle('🚀 New Bot Update Available!')
          .setDescription(
            `A new version was pushed to your remote repository!\n\n` +
            `• **Current Local Commit:** \`${status.currentCommit}\`\n` +
            `• **Latest Remote Commit:** \`${status.latestCommit}\`\n` +
            (status.commitMessage ? `• **Update Notes:** \`${status.commitMessage}\`\n\n` : '\n') +
            `Run **/bot-update action:🚀 Pull Updates & Rebuild Bot** to update now!`
          )
          .setColor(COLORS.WARNING)
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      const embed = new EmbedBuilder()
        .setTitle('✅ Bot is Up-To-Date!')
        .setDescription(`You are running the latest version (\`${status.currentCommit}\`). No updates needed.`)
        .setColor(COLORS.SUCCESS)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // Action: update
    const statusBefore = await checkGitUpdates();
    const progressEmbed = new EmbedBuilder()
      .setTitle('🔄 Updating Bot from Git...')
      .setDescription(
        '1️⃣ Pulling latest commits...\n' +
        '2️⃣ Installing dependencies...\n' +
        '3️⃣ Rebuilding TypeScript code...\n\n' +
        '⏳ _Please wait..._'
      )
      .setColor(COLORS.PRIMARY)
      .setTimestamp();

    await interaction.editReply({ embeds: [progressEmbed] });

    const result = await performGitUpdate();

    if (!result.success) {
      const failEmbed = new EmbedBuilder()
        .setTitle('❌ Auto-Update Failed')
        .setDescription(`An error occurred while updating:\n\`\`\`bash\n${result.error || 'Unknown error'}\n\`\`\``)
        .setColor(COLORS.DANGER)
        .setTimestamp();

      return interaction.editReply({ embeds: [failEmbed] });
    }

    const successEmbed = new EmbedBuilder()
      .setTitle('🎉 Auto-Update & Build Complete!')
      .setDescription(
        `Successfully updated to commit **\`${statusBefore.latestCommit || 'Latest'}\`**!\n\n` +
        `🔄 **Restarting bot process in 3 seconds...** (Pterodactyl panel will automatically relaunch the new build!)`
      )
      .setColor(COLORS.SUCCESS)
      .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed] });

    // Exit process with 0 so Pterodactyl container / systemd auto-restarts with new code
    setTimeout(() => {
      process.exit(0);
    }, 3000);
  },
};
