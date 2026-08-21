import { Router } from 'express';
import { config } from '../../config';
import prisma from '../../database/prisma';

const router = Router();

router.get('/callback', async (req, res) => {
  const { code, state } = req.query;

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

    // 2. Fetch user ID
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

    // 3. Save to database
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    const player = await prisma.player.findUnique({ where: { discordId } });

    if (!player) {
      return res.status(404).send('You must register with the bot (e.g. /verify) before authorizing backup!');
    }

    await prisma.player.update({
      where: { discordId },
      data: {
        discordAccessToken: access_token,
        discordRefreshToken: refresh_token,
        discordTokenExpiresAt: expiresAt,
      },
    });

    res.send(`
      <html>
        <body style="background-color: #2b2d31; color: white; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh;">
          <div style="text-align: center; background-color: #1e1f22; padding: 40px; border-radius: 10px;">
            <h1 style="color: #57F287;">✅ Backup Authorized!</h1>
            <p>Your account has been successfully linked to the backup system.</p>
            <p style="color: #99aab5;">You can now close this tab and return to Discord.</p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('OAuth2 Error:', error);
    res.status(500).send('Internal server error.');
  }
});

export default router;
