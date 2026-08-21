import { MINECRAFT_API_URL } from '../config/constants';

interface MojangProfile {
  id: string;
  name: string;
}

/**
 * Fetch Minecraft UUID and confirm the correct username casing from Mojang API
 */
export async function fetchMinecraftProfile(username: string): Promise<MojangProfile | null> {
  try {
    const response = await fetch(`${MINECRAFT_API_URL}/users/profiles/minecraft/${encodeURIComponent(username)}`);
    if (!response.ok) return null;
    const data = await response.json() as MojangProfile;
    return data;
  } catch {
    return null;
  }
}

/**
 * Get the URL for a Minecraft player's 3D isometric head (skin)
 */
export function getPlayerHeadUrl(usernameOrUuid: string): string {
  return `https://mc-heads.net/head/${encodeURIComponent(usernameOrUuid)}/128`;
}


/**
 * Validate Minecraft username format
 */
export function isValidMinecraftUsername(username: string): boolean {
  return /^[a-zA-Z0-9_]{3,16}$/.test(username);
}
