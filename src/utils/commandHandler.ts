import { Client, Collection, REST, Routes } from 'discord.js';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

export interface Command {
  data: any; // SlashCommandBuilder
  execute: (interaction: any) => Promise<void>;
}

export const commands = new Collection<string, Command>();

export const loadCommands = (client: Client) => {
  const commandsPath = path.join(__dirname, '../commands');
  
  if (!fs.existsSync(commandsPath)) return;

  const commandFolders = fs.readdirSync(commandsPath);
  
  for (const folder of commandFolders) {
    const folderPath = path.join(commandsPath, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;

    const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));
    for (const file of commandFiles) {
      const filePath = path.join(folderPath, file);
      const command = require(filePath).default as Command;
      if ('data' in command && 'execute' in command) {
        commands.set(command.data.name, command);
      } else {
        console.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
      }
    }
  }
};

export const registerCommands = async (client?: Client) => {
  const rest = new REST().setToken(config.discordToken);
  const commandData = commands.map(cmd => cmd.data.toJSON());

  try {
    console.log(`Started refreshing ${commandData.length} application (/) commands globally.`);
    // 1. Clear global commands to prevent duplicates
    await rest.put(
      Routes.applicationCommands(config.discordClientId),
      { body: [] },
    );
    console.log(`Successfully cleared global application (/) commands to prevent duplicates.`);

    // 2. Register commands for each guild the bot is in (instant update)
    if (client) {
      for (const [guildId, guild] of client.guilds.cache) {
        try {
          await rest.put(
            Routes.applicationGuildCommands(config.discordClientId, guildId),
            { body: commandData },
          );
          console.log(`Successfully reloaded application (/) commands for server ${guild.name} (${guildId}).`);
        } catch (guildErr) {
          console.error(`Failed to register commands for server ${guildId}:`, guildErr);
        }
      }
    } else if (config.discordGuildId) {
      await rest.put(
        Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
        { body: commandData },
      );
    }
  } catch (error) {
    console.error('Error registering application commands:', error);
  }
};
