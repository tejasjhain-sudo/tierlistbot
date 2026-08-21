import { Router } from 'express';
import { config } from '../../config';
import prisma from '../../database/prisma';
import { getDiscordClient } from '../server';
import { giveAuthorisedRole, removeUnauthorisedRole, syncGuildMemberRoles } from '../../services/roleService';

const router = Router();

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
      console.error('Discord OAuth Token Error:', tokenData);
      return res.status(400).send('Failed to get token from Discord.');
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

    // 3. Upsert user tokens in database
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

    // 4. Update Roles in Discord Server (Remove Unauthorised, Add Authorised)
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
            try {
              await member.send(`🎉 **Verification Successful!** You now have full access to all channels, tier testing waitlists, and announcements in **${guild.name}**.`);
            } catch {}
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
          <title>Verification Complete • RearMC</title>
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

