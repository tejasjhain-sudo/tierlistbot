import { ButtonInteraction, StringSelectMenuInteraction, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { Mode } from '../../config/constants';
import { MODES, COLORS } from '../../config/constants';
import { createHighTierTicket } from '../../services/highTicketService';

export async function handleOpenHighTicketPrompt(interaction: ButtonInteraction): Promise<any> {
  await interaction.deferReply({ ephemeral: true });

  const selectOptions = Object.entries(MODES).map(([key, value]) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(value)
      .setValue(key)
  );

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('select_high_ticket_mode')
      .setPlaceholder('Select gamemode for High Tier Test')
      .addOptions(selectOptions)
  );

  const embed = new EmbedBuilder()
    .setTitle('🔥 Select High Tier Gamemode')
    .setDescription('Select the gamemode you want to request a High Tier Test for:')
    .setColor(COLORS.PRIMARY);

  return interaction.editReply({ embeds: [embed], components: [selectRow] });
}

export async function handleSelectHighTicketMode(interaction: StringSelectMenuInteraction): Promise<any> {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });

  const mode = interaction.values[0] as Mode;
  const result = await createHighTierTicket(interaction.guild, interaction.user.id, mode);

  const embed = new EmbedBuilder()
    .setTitle(result.success ? '✅ Ticket Created' : '❌ Ticket Request Denied')
    .setDescription(result.message)
    .setColor(result.success ? COLORS.SUCCESS : COLORS.DANGER)
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}
