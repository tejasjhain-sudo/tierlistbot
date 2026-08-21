import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './config';
import prisma from './database/prisma';
import { loadCommands, registerCommands } from './utils/commandHandler';
import { handleInteraction } from './events/interactionCreate';
import { handleReady } from './events/ready';
import { startApiServer } from './api/server';
import { handleStaffApplyMessage } from './services/staffApplicationService';
import { printStartupBanner } from './utils/banner';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
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

    // Start REST API
    startApiServer(client);

    // Login the bot
    await client.login(config.discordToken);
  } catch (error) {
    console.error('Fatal error during startup:', error);
    process.exit(1);
  }
}

main();
