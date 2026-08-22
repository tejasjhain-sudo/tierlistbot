import {
  Client,
  GatewayIntentBits,
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  OverwriteResolvable,
} from 'discord.js';
import { config } from '../config';
import prisma from '../database/prisma';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

export async function applyServerGatedPermissions(guildId: string) {
  const guild = await client.guilds.fetch(guildId);
  console.log(`\n🔧 Applying Gated Permissions to server: ${guild.name} (${guild.id})...`);

  const roles = await guild.roles.fetch();
  let adminRole = roles.find(r => r.name === 'Tier Admin');
  let managerRole = roles.find(r => r.name === 'Tier Manager');
  let generalTesterRole = roles.find(r => r.name === 'Tier Tester');
  let registeredRole = roles.find(r => r.name === 'Registered');
  let authorisedRole = roles.find(r => r.name.toLowerCase() === 'authorised' || r.name.toLowerCase() === 'verified');
  let unauthorisedRole = roles.find(r => r.name.toLowerCase() === 'unauthorised' || r.name.toLowerCase() === 'unverified');

  if (!unauthorisedRole) {
    unauthorisedRole = await guild.roles.create({
      name: 'Unauthorised',
      color: '#7F8C8D',
      reason: 'Auto-created by permission fixer',
    });
  }
  if (!authorisedRole) {
    authorisedRole = await guild.roles.create({
      name: 'Authorised',
      color: '#2ECC71',
      hoist: true,
      reason: 'Auto-created by permission fixer',
    });
  }

  const staffRoles = roles.filter(r =>
    r.name.includes('Tester') || r.name.includes('Admin') || r.name.includes('Manager')
  );

  const channels = await guild.channels.fetch();

  for (const [, ch] of channels) {
    if (!ch) continue;

    // A. Verification Category / Channel
    if (ch.name.toLowerCase().includes('verification') || ch.name.includes('verify')) {
      console.log(`Setting VERIFY permissions on: ${ch.name}`);
      try {
        await ch.permissionOverwrites.set([
          {
            id: guild.roles.everyone.id,
            type: OverwriteType.Role,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions],
          },
          {
            id: unauthorisedRole.id,
            type: OverwriteType.Role,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions],
          },
          {
            id: authorisedRole.id,
            type: OverwriteType.Role,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          ...(registeredRole ? [{
            id: registeredRole.id,
            type: OverwriteType.Role,
            deny: [PermissionFlagsBits.ViewChannel],
          }] : []),
          ...(adminRole ? [{
            id: adminRole.id,
            type: OverwriteType.Role,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          }] : []),
        ]);
      } catch (e: any) {
        console.warn(`Could not set verify overwrites on ${ch.name}:`, e.message);
      }
      continue;
    }

    // B. Admin logs / Private Tester Hub
    if (ch.name.includes('Admin') || ch.name.includes('logs') || ch.name.includes('Tester') || ch.name.includes('TOURNAMENT REVIEW')) {
      continue; // keep existing private staff overwrites
    }

    // C. All other normal categories and channels (' | Important, ' | Requests, ' | Tierlists, ' | Waitlist)
    if (ch.type === ChannelType.GuildCategory) {
      console.log(`Setting PUBLIC CATEGORY permissions on: ${ch.name}`);
      try {
        const catOverwrites: OverwriteResolvable[] = [
          {
            id: guild.roles.everyone.id,
            type: OverwriteType.Role,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: unauthorisedRole.id,
            type: OverwriteType.Role,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: authorisedRole.id,
            type: OverwriteType.Role,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
          },
          ...(registeredRole ? [{
            id: registeredRole.id,
            type: OverwriteType.Role,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
          }] : []),
        ];

        for (const [, sr] of staffRoles) {
          catOverwrites.push({
            id: sr.id,
            type: OverwriteType.Role,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          });
        }

        await ch.permissionOverwrites.set(catOverwrites);
      } catch (e: any) {
        console.warn(`Could not set category overwrites on ${ch.name}:`, e.message);
      }
    } else if (ch.isTextBased() || ch.isVoiceBased()) {
      // Sync or ensure @everyone and Unauthorised are denied
      try {
        await ch.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false });
        await ch.permissionOverwrites.edit(unauthorisedRole.id, { ViewChannel: false });
        await ch.permissionOverwrites.edit(authorisedRole.id, { ViewChannel: true, ReadMessageHistory: true });
        if (registeredRole) {
          await ch.permissionOverwrites.edit(registeredRole.id, { ViewChannel: true, ReadMessageHistory: true });
        }
      } catch (e: any) {}
    }
  }

  // Update Database GuildConfig with verified role IDs
  const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
  const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};
  roleIds.unauthorised = unauthorisedRole.id;
  roleIds.authorised = authorisedRole.id;
  if (registeredRole) roleIds.registered = registeredRole.id;

  await prisma.guildConfig.upsert({
    where: { guildId: guild.id },
    update: { roleIds },
    create: {
      guildId: guild.id,
      roleIds,
    },
  });

  console.log(`✅ All permissions successfully fixed and secured across ${guild.name}!`);
}

async function run() {
  await client.login(config.discordToken);
  await applyServerGatedPermissions(config.discordGuildId);
  client.destroy();
}

run().catch(console.error);
