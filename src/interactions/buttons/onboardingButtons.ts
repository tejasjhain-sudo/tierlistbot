import {
  ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { COLORS } from '../../config/constants';
import { PING_ROLES } from '../selectMenus/pingRolesSelect';

export async function handleOnboardingPingRolesPrompt(interaction: ButtonInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle('🔔 Select Your Notification Pings')
    .setDescription(
      'Choose the roles you would like to be pinged for in the server!\n\n' +
      '• **Testing Ping** — Get alerted when testing queues open\n' +
      '• **Announcements Ping** — Important server updates & announcements\n' +
      '• **Updates Ping** — Tierlist balance changes & bot patch notes\n' +
      '• **Events Ping** — Tournaments, community events & giveaways\n\n' +
      'You can pick multiple options below and change them at any time.'
    )
    .setColor(COLORS.PRIMARY);

  const selectOptions = PING_ROLES.map(r =>
    new StringSelectMenuOptionBuilder()
      .setLabel(r.label)
      .setValue(r.id)
      .setDescription(`Receive notifications for ${r.label}`)
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('ping_roles_select')
    .setPlaceholder('Click to select notification pings...')
    .setMinValues(0)
    .setMaxValues(PING_ROLES.length)
    .addOptions(selectOptions);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true,
  });
}
