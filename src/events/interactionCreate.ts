import {
  Client,
  Interaction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { commands } from '../utils/commandHandler';
import { Mode, Region } from '../config/constants';

import {
  handleVerifyAccount,
  handleEnterWaitlist,
  handleJoinNormalWaitlists,
  handleViewCooldown,
  handleRegister,
  handleRegisterUpdate,
  handleActionStartRegister,
  handleActionStartUpdate,
  handleUpdateProfile,
  handleMyProfile,
  handleLeaveAllQueues,
  handleQueueJoin,
  handleQueueLeave,
  handleQueuePosition,
  handleQueueRefresh,
} from '../interactions/buttons/registrationButtons';

import {
  handleRegisterModal,
  handleUpdateProfileModal,
  handleVerifyAccountModal,
  handleUpdateAccountModal,
  handleCompleteTestModal,
} from '../interactions/modals/registrationModals';

import {
  handleCompleteTest,
  handleSkipButton,
  handleCancelSession,
  handleCloseTicket,
  handleSkipAction,
} from '../interactions/buttons/ticketButtons';

import {
  handleRegisterRegion,
  handleRegisterMode,
  handleUpdateRegion,
  handleUpdateMode,
} from '../interactions/selectMenus/registrationSelects';

import { handleWaitlistRoleSelect } from '../interactions/selectMenus/waitlistRoleSelect';
import { handlePingRolesSelect } from '../interactions/selectMenus/pingRolesSelect';
import { showSupportTicketModal, handleSupportTicketSubmit } from '../services/supportTicketService';
import { handleOpenHighTicketPrompt, handleSelectHighTicketMode } from '../interactions/buttons/highTicketButtons';
import { showTesterApplicationModal, handleTesterApplicationSubmit } from '../services/testerApplicationService';
import { handleMassDMSubmit } from '../commands/admin/massDM';
import { startStaffApplication, handleStaffAppAccept, handleStaffAppDecline } from '../services/staffApplicationService';

export const handleInteraction = async (client: Client, interaction: Interaction) => {
  // ─── Slash commands ──────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const command = commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Error executing command /${interaction.commandName}:`, error);
      const reply = { content: '❌ An error occurred while executing this command.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
    return;
  }

  // ─── Autocomplete interactions ───────────────────────────────────────────────
  if (interaction.isAutocomplete()) {
    const command = commands.get(interaction.commandName);
    if (command && typeof (command as any).autocomplete === 'function') {
      try {
        await (command as any).autocomplete(interaction);
      } catch (error) {
        console.error(`Autocomplete error for /${interaction.commandName}:`, error);
      }
    }
    return;
  }

  // ─── Button interactions ─────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const id = interaction.customId;
    try {
      if (id === 'apply_tester_prompt') return showTesterApplicationModal(interaction as ButtonInteraction);
      if (id === 'request_support_prompt') return showSupportTicketModal(interaction as ButtonInteraction);
      if (id === 'open_high_ticket_prompt') return handleOpenHighTicketPrompt(interaction as ButtonInteraction);
      if (id === 'verify_account') return handleVerifyAccount(interaction as ButtonInteraction);
      if (id === 'enter_waitlist') return handleEnterWaitlist(interaction as ButtonInteraction);
      if (id === 'join_normal_waitlists') return handleJoinNormalWaitlists(interaction as ButtonInteraction);
      if (id === 'view_cooldown') return handleViewCooldown(interaction as ButtonInteraction);
      if (id === 'register') return handleRegister(interaction as ButtonInteraction);
      if (id === 'register_update') return handleRegisterUpdate(interaction as ButtonInteraction);
      if (id === 'action_start_register') return handleActionStartRegister(interaction as ButtonInteraction);
      if (id === 'action_start_update') return handleActionStartUpdate(interaction as ButtonInteraction);
      if (id === 'update_profile') return handleUpdateProfile(interaction as ButtonInteraction);
      if (id === 'my_profile') return handleMyProfile(interaction as ButtonInteraction);
      if (id === 'leave_all_queues') return handleLeaveAllQueues(interaction as ButtonInteraction);

      if (id.startsWith('staff_app_accept_')) {
        return handleStaffAppAccept(interaction as ButtonInteraction, id.replace('staff_app_accept_', ''));
      }
      if (id.startsWith('staff_app_decline_')) {
        return handleStaffAppDecline(interaction as ButtonInteraction, id.replace('staff_app_decline_', ''));
      }

      // Support ticket close button
      if (id.startsWith('close_support_ticket_')) {
        await interaction.reply({ content: '🔒 Closing support ticket in 3 seconds...', ephemeral: true });
        setTimeout(() => interaction.channel?.delete().catch(() => {}), 3000);
        return;
      }

      // Tester application accept / deny buttons
      if (id.startsWith('accept_tester_app_')) {
        const applicantId = id.replace('accept_tester_app_', '');
        await interaction.reply({ content: `✅ <@${applicantId}>'s tester application has been **ACCEPTED** by <@${interaction.user.id}>.`, ephemeral: false });
        try {
          const user = await client.users.fetch(applicantId);
          await user.send('🎉 **Congratulations!** Your RearMC Tier Tester application has been **ACCEPTED**! A staff member will assign your tester roles shortly.');
        } catch {}
        return;
      }

      if (id.startsWith('deny_tester_app_')) {
        const applicantId = id.replace('deny_tester_app_', '');
        await interaction.reply({ content: `❌ <@${applicantId}>'s tester application has been **DENIED** by <@${interaction.user.id}>.`, ephemeral: false });
        try {
          const user = await client.users.fetch(applicantId);
          await user.send('❌ Thank you for applying. Unfortunately, your RearMC Tier Tester application was not accepted at this time.');
        } catch {}
        return;
      }

      if (id.startsWith('delete_tester_app_')) {
        await interaction.reply({ content: '🗑️ This ticket will be deleted in 10 seconds...', ephemeral: false });
        setTimeout(() => {
          (interaction as ButtonInteraction).channel?.delete().catch(() => {});
        }, 10000);
        return;
      }

      // Queue buttons: queue_join_{mode}, queue_leave_{mode}, queue_position_{mode}, queue_refresh_{mode}
      if (id.startsWith('queue_join_')) return handleQueueJoin(interaction as ButtonInteraction, id.replace('queue_join_', '') as Mode);
      if (id.startsWith('queue_leave_')) return handleQueueLeave(interaction as ButtonInteraction, id.replace('queue_leave_', '') as Mode);
      if (id.startsWith('queue_position_')) return handleQueuePosition(interaction as ButtonInteraction, id.replace('queue_position_', '') as Mode);
      if (id.startsWith('queue_refresh_')) return handleQueueRefresh(interaction as ButtonInteraction, id.replace('queue_refresh_', '') as Mode);

      // Ticket buttons: complete_test_{sessionId}, skip_player_{sessionId}, cancel_session_{sessionId}, close_ticket_{sessionId}
      if (id.startsWith('complete_test_')) return handleCompleteTest(interaction as ButtonInteraction, id.replace('complete_test_', ''));
      if (id.startsWith('skip_player_')) return handleSkipButton(interaction as ButtonInteraction, id.replace('skip_player_', ''));
      if (id.startsWith('cancel_session_')) return handleCancelSession(interaction as ButtonInteraction, id.replace('cancel_session_', ''));
      if (id.startsWith('close_ticket_')) return handleCloseTicket(interaction as ButtonInteraction, id.replace('close_ticket_', ''));

      // Skip action buttons: skip_front_{sessionId}, skip_back_{sessionId}, skip_remove_{sessionId}
      if (id.startsWith('skip_front_')) return handleSkipAction(interaction as ButtonInteraction, id.replace('skip_front_', ''), 'front');
      if (id.startsWith('skip_back_')) return handleSkipAction(interaction as ButtonInteraction, id.replace('skip_back_', ''), 'back');
      if (id.startsWith('skip_remove_')) return handleSkipAction(interaction as ButtonInteraction, id.replace('skip_remove_', ''), 'remove');

    } catch (err) {
      console.error('Button interaction error:', err);
      await (interaction as ButtonInteraction).reply({ content: '❌ Something went wrong.', ephemeral: true }).catch(() => {});
    }
    return;
  }

  // ─── Modal submit interactions ────────────────────────────────────────────────
  if (interaction.isModalSubmit()) {
    const id = interaction.customId;
    try {
      if (id.startsWith('mass_dm_modal')) return handleMassDMSubmit(interaction as ModalSubmitInteraction);
      if (id === 'submit_tester_app_modal') return handleTesterApplicationSubmit(interaction as ModalSubmitInteraction);
      if (id === 'submit_support_ticket_modal') return handleSupportTicketSubmit(interaction as ModalSubmitInteraction);
      if (id === 'register_modal') return handleRegisterModal(interaction as ModalSubmitInteraction);
      if (id === 'update_profile_modal') return handleUpdateProfileModal(interaction as ModalSubmitInteraction);
      if (id === 'verify_account_modal') return handleVerifyAccountModal(interaction as ModalSubmitInteraction);
      if (id === 'update_account_modal') return handleUpdateAccountModal(interaction as ModalSubmitInteraction);
      if (id.startsWith('complete_test_modal_')) return handleCompleteTestModal(interaction as ModalSubmitInteraction, id.replace('complete_test_modal_', ''));
    } catch (err) {
      console.error('Modal submit error:', err);
    }
    return;
  }

  // ─── Select menu interactions ─────────────────────────────────────────────────
  if (interaction.isStringSelectMenu()) {
    const id = interaction.customId;
    try {
      if (id === 'staff_apply_select') {
        return startStaffApplication(interaction as StringSelectMenuInteraction);
      }
      if (id === 'select_high_ticket_mode') {
        return handleSelectHighTicketMode(interaction as StringSelectMenuInteraction);
      }
      if (id === 'ping_roles_select') {
        return handlePingRolesSelect(interaction as StringSelectMenuInteraction);
      }
      if (id === 'waitlist_role_select') {
        return handleWaitlistRoleSelect(interaction as StringSelectMenuInteraction);
      }
      if (id.startsWith('register_region_')) {
        const mcUsername = decodeURIComponent(id.replace('register_region_', ''));
        return handleRegisterRegion(interaction as StringSelectMenuInteraction, mcUsername);
      }
      if (id.startsWith('register_mode_')) {
        const parts = id.replace('register_mode_', '').split('_');
        const region = parts.pop() as Region;
        const mcUsername = decodeURIComponent(parts.join('_'));
        return handleRegisterMode(interaction as StringSelectMenuInteraction, mcUsername, region);
      }
      if (id.startsWith('update_region_')) {
        const mcUsername = decodeURIComponent(id.replace('update_region_', ''));
        return handleUpdateRegion(interaction as StringSelectMenuInteraction, mcUsername);
      }
      if (id.startsWith('update_mode_')) {
        const parts = id.replace('update_mode_', '').split('_');
        const region = parts.pop() as Region;
        const mcUsername = decodeURIComponent(parts.join('_'));
        return handleUpdateMode(interaction as StringSelectMenuInteraction, mcUsername, region);
      }
    } catch (err) {
      console.error('Select menu error:', err);
    }
    return;
  }
};
