import { Client, GatewayIntentBits } from 'discord.js';
import { config } from '../config';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

async function inspectGuild() {
  await client.login(config.discordToken);
  const guild = await client.guilds.fetch(config.discordGuildId);
  console.log(`\n🏰 Inspecting Guild: ${guild.name} (${guild.id})`);

  console.log('\n--- ROLES ---');
  const roles = await guild.roles.fetch();
  for (const [, r] of roles) {
    if (r.name.includes('Author') || r.name.includes('Unauthor') || r.name.includes('Register') || r.name.includes('Tier')) {
      console.log(`Role: "${r.name}" | ID: ${r.id} | Position: ${r.position}`);
    }
  }

  console.log('\n--- CHANNELS & PERMISSIONS ---');
  const channels = await guild.channels.fetch();
  for (const [, c] of channels) {
    if (!c) continue;
    if (c.name.includes('verify') || c.name.includes('Verification') || c.name.includes('rules') || c.name.includes('request')) {
      console.log(`Channel: "${c.name}" (${c.type}) | ID: ${c.id} | Parent: ${c.parentId}`);
      if ('permissionOverwrites' in c) {
        c.permissionOverwrites.cache.forEach(po => {
          const roleOrUser = roles.get(po.id)?.name || po.id;
          console.log(`   - Overwrite: [${roleOrUser}] Allow: ${po.allow.toArray().join(',')} | Deny: ${po.deny.toArray().join(',')}`);
        });
      }
    }
  }

  client.destroy();
}

inspectGuild().catch(console.error);
