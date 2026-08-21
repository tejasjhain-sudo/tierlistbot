import dotenv from 'dotenv';

dotenv.config();

export const config = {
  discordToken: process.env.DISCORD_TOKEN || '',
  discordClientId: process.env.DISCORD_CLIENT_ID || '',
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET || '',
  discordGuildId: process.env.DISCORD_GUILD_ID || '',
  databaseUrl: process.env.DATABASE_URL || '',
  apiPort: parseInt(process.env.API_PORT || '3000', 10),
  apiSecret: process.env.API_SECRET || '',
  publicApiUrl: process.env.PUBLIC_API_URL || '',
  corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : [],
  nodeEnv: process.env.NODE_ENV || 'development',
};

// Validation
if (!config.discordToken) {
  console.warn('Missing DISCORD_TOKEN environment variable');
}
if (!config.discordClientId) {
  console.warn('Missing DISCORD_CLIENT_ID environment variable');
}
if (!config.discordGuildId) {
  console.warn('Missing DISCORD_GUILD_ID environment variable');
}
