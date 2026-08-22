import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './config';
import prisma from './database/prisma';
import { loadCommands, registerCommands } from './utils/commandHandler';
import { handleInteraction } from './events/interactionCreate';
import { handleReady } from './events/ready';
import { startApiServer } from './api/server';
import { handleStaffApplyMessage } from './services/staffApplicationService';
import { handleGuildMemberAdd } from './events/guildMemberAdd';
import { printStartupBanner } from './utils/banner';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

async function main() {
  try {
    // Print stylish startup banner, verify license & check auto-updater
    await printStartupBanner();

    // Load commands before registering
    loadCommands(client);

    // Wire events
    client.once('ready', async () => {
      await registerCommands(client);
      try {
        await handleReady(client);
      } catch (e) {
        console.error('Ready handler error (DB likely disconnected):', e);
      }
    });

    client.on('guildCreate', async (guild) => {
      console.log(`[Guild Joined] Added to new server: ${guild.name} (${guild.id})`);
      await registerCommands(client);
    });

    client.on('interactionCreate', (interaction) => {
      handleInteraction(client, interaction);
    });

    client.on('messageCreate', (message) => {
      handleStaffApplyMessage(message);
    });

    client.on('guildMemberAdd', (member) => {
      handleGuildMemberAdd(member);
    });

    // Start REST API
    startApiServer(client);

    // Login the bot with graceful intent handling
    try {
      await client.login(config.discordToken);
    } catch (loginErr: any) {
      if (loginErr.message?.includes('disallowed intents')) {
        console.error('\n⚠️ [Privileged Intents Required]');
        console.error('👉 Go to: https://discord.com/developers/applications/' + config.discordClientId + '/bot');
        console.error('👉 Scroll down to "Privileged Gateway Intents"');
        console.error('👉 Enable: ✅ SERVER MEMBERS INTENT and ✅ MESSAGE CONTENT INTENT, then save!\n');
      }
      throw loginErr;
    }
  } catch (error) {
    console.error('Fatal error during startup:', error);
    process.exit(1);
  }
}

main();
