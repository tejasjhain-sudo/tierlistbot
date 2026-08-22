import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { config } from '../../config';
import prisma from '../../database/prisma';
import { getDiscordClient } from '../server';
import { giveAuthorisedRole, removeUnauthorisedRole, syncGuildMemberRoles } from '../../services/roleService';

const router = Router();

// Initialize Supabase Client if env vars exist
let supabase: any = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
  try {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  } catch (e) {
    console.warn('[Supabase] Could not initialize Supabase client:', e);
  }
}

router.get('/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('No code provided by Discord.');
  }

  try {
    const redirectUri = `${config.publicApiUrl}/api/auth/callback`;

    // 1. Exchange code for token
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.discordClientId,
        client_secret: config.discordClientSecret,
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('Discord OAuth Token Error Details:', JSON.stringify(tokenData, null, 2));
      const reason = tokenData.error_description || tokenData.error || 'Unknown Discord OAuth error';
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <body style="background-color: #0f1117; color: #ffffff; font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0;">
            <div style="text-align: center; background-color: #1a1d26; padding: 40px; border-radius: 16px; border: 1px solid #ef4444; max-width: 480px;">
              <h2 style="color: #ef4444;">❌ Discord Verification Error</h2>
              <p style="color: #cbd5e1;">${reason}</p>
              <p style="color: #94a3b8; font-size: 13px;">If you see <code>invalid_client</code>, the Discord Client Secret in .env needs to be updated.<br>If you see <code>invalid_grant</code>, the link expired — please click <b>Verify</b> in Discord again.</p>
            </div>
          </body>
        </html>
      `);
    }

    const { access_token, refresh_token, expires_in } = tokenData;

    // 2. Fetch user info
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    const userData = await userResponse.json();

    if (!userResponse.ok) {
      return res.status(400).send('Failed to fetch user info.');
    }

    const discordId = userData.id;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // 3. Upsert user tokens in local SQLite database
    const player = await prisma.player.findUnique({ where: { discordId } });

    if (player) {
      await prisma.player.update({
        where: { discordId },
        data: {
          discordAccessToken: access_token,
          discordRefreshToken: refresh_token,
          discordTokenExpiresAt: expiresAt,
        },
      });
    } else {
      const username = userData.username || `User_${discordId.slice(-4)}`;
      await prisma.player.create({
        data: {
          discordId,
          minecraftUsername: username,
          minecraftUsernameLower: username.toLowerCase(),
          region: 'AS',
          preferredMode: 'sword',
          discordAccessToken: access_token,
          discordRefreshToken: refresh_token,
          discordTokenExpiresAt: expiresAt,
        },
      });
    }

    // 4. Send Backup to Supabase
    if (supabase) {
      try {
        await supabase.from('backup_players').upsert({
          discord_id: discordId,
          username: userData.username,
          access_token,
          refresh_token,
          expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'discord_id' });
        console.log(`[Supabase Backup] ✅ Backed up player ${userData.username} (${discordId}) to Supabase.`);
      } catch (sbErr) {
        console.warn(`[Supabase Backup] Warning: Could not write backup to Supabase:`, sbErr);
      }
    }

    // 5. Update Roles in Discord Server (Remove Unauthorised, Add Authorised)
    const client = getDiscordClient();
    if (client) {
      for (const [, guild] of client.guilds.cache) {
        try {
          const member = await guild.members.fetch(discordId).catch(() => null);
          if (member) {
            await removeUnauthorisedRole(member);
            await giveAuthorisedRole(member);
            await syncGuildMemberRoles(member);

            console.log(`[Verification] Verified and granted full access to ${member.user.tag} in ${guild.name}`);
          }
        } catch (e) {
          console.warn(`[Verification] Could not update roles for member in guild ${guild.name}:`, e);
        }
      }
    }

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Verification Complete • Arix Tierlist</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="background-color: #0f1117; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box;">
          <div style="text-align: center; background-color: #1a1d26; padding: 48px 36px; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); max-width: 440px; width: 100%; border: 1px solid #2e3446;">
            <div style="font-size: 56px; margin-bottom: 16px;">🛡️</div>
            <h1 style="color: #4ade80; font-size: 26px; margin-bottom: 12px; font-weight: 700;">Verification Successful!</h1>
            <p style="color: #cbd5e1; font-size: 16px; line-height: 1.5; margin-bottom: 24px;">Your Discord account has been verified. You now have full access to all server channels, tier testing, and events.</p>
            <div style="background-color: #242938; padding: 14px 20px; border-radius: 10px; color: #94a3b8; font-size: 14px; margin-bottom: 28px;">
              ✅ Authorised role unlocked<br>
              🔒 Server backup & sync active
            </div>
            <p style="color: #64748b; font-size: 13px; margin: 0;">You may now return to Discord.</p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('OAuth2 Verification Error:', error);
    res.status(500).send('Internal server error during verification.');
  }
});

export default router;
