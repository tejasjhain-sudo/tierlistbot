import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import prisma from '../../database/prisma';

const data = new SlashCommandBuilder()
  .setName('add-staff')
  .setDescription('Give a player a specific tier staff role.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles) // Usable by Tier Admins/Admins
  .addUserOption(option => 
    option.setName('user')
      .setDescription('The user to give the role to')
      .setRequired(true))
  .addRoleOption(option => 
    option.setName('role')
      .setDescription('The role to grant to the user')
      .setRequired(true))
  .addStringOption(option =>
    option.setName('kit')
      .setDescription('The specific kit/mode if adding a Tester (e.g. sword, axe)')
      .setRequired(false)
      .addChoices(
        { name: 'Sword', value: 'sword' },
        { name: 'Axe', value: 'axe' },
        { name: 'SMP', value: 'smp' },
        { name: 'Pot', value: 'pot' },
        { name: 'UHC', value: 'uhc' }
      ));

async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser('user', true);
  const targetRole = interaction.options.getRole('role', true);
  const kit = interaction.options.getString('kit');

  const guildConfig = await prisma.guildConfig.findUnique({
    where: { guildId: interaction.guild.id }
  });

  let kitRoleId: string | undefined;
  if (kit && guildConfig) {
    const roleIds = guildConfig.roleIds as any;
    kitRoleId = roleIds?.testers?.[kit];
  }

  try {
    const member = await interaction.guild.members.fetch(targetUser.id);
    await member.roles.add(targetRole.id as string);
    
    let msg = `✅ Successfully gave <@${targetUser.id}> the <@&${targetRole.id}> role!`;
    
    if (kitRoleId) {
      await member.roles.add(kitRoleId);
      msg = `✅ Successfully gave <@${targetUser.id}> the <@&${targetRole.id}> AND <@&${kitRoleId}> roles!`;
    }
    
    await interaction.editReply(msg);
  } catch (error) {
    console.error('Error adding staff role:', error);
    await interaction.editReply('❌ Failed to add the role. Make sure the bot has a higher role than the role it is trying to assign.');
  }
}

export default { data, execute };
