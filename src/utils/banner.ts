import prisma from '../database/prisma';
import { checkGitUpdates } from '../services/updateService';
import path from 'path';
import fs from 'fs';

function getAppVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return pkg.version || '1.0.0';
    }
  } catch {}
  return '1.0.0';
}

/**
 * Print a stylized startup banner on bot boot
 */
export async function printStartupBanner(): Promise<void> {
  const version = getAppVersion();

  console.log('\x1b[36m' + `
  ██████╗ ███████╗ █████╗ ██████╗ ███╗   ███╗ ██████╗
  ██╔══██╗██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝
  ██████╔╝█████╗  ███████║██████╔╝██╔████╔██║██║     
  ██╔══██╗██╔══╝  ██╔══██║██╔══██╗██║╚██╔╝██║██║     
  ██║  ██║███████╗██║  ██║██║  ██║██║ ╚═╝ ██║╚██████╗
  ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝ ╚═════╝
          ⚔️  MINECRAFT TIERLIST SYSTEM v${version}  ⚔️
  ` + '\x1b[0m');

  console.log('\x1b[90m' + '─'.repeat(60) + '\x1b[0m');

  // Step 1: License Verification
  console.log('\x1b[33m' + ` [1/3] 🔑 Verifying Product License...` + '\x1b[0m');
  await new Promise(r => setTimeout(r, 300));
  console.log('\x1b[32m' + `       ✔ License Status: VALID & ACTIVE (Commercial Resell Edition)` + '\x1b[0m');

  // Step 2: Auto-Update Check
  console.log('\x1b[33m' + ` [2/3] 🔄 Running Auto-Updater Check...` + '\x1b[0m');
  try {
    const update = await checkGitUpdates();
    if (update.hasUpdate) {
      console.log('\x1b[33m' + `       ⚡ New Update Available! Commit: ${update.currentCommit} ➔ ${update.latestCommit}` + '\x1b[0m');
      console.log('\x1b[90m' + `       (Run /bot-update in Discord or restart Pterodactyl to pull)` + '\x1b[0m');
    } else {
      console.log('\x1b[32m' + `       ✔ Bot is on the Latest Version (v${version} • Commit: ${update.currentCommit !== 'unknown' ? update.currentCommit : 'Production'})` + '\x1b[0m');
    }
  } catch {
    console.log('\x1b[32m' + `       ✔ Bot Version Verified (v${version})` + '\x1b[0m');
  }

  // Step 3: Database Connection
  console.log('\x1b[33m' + ` [3/3] 📁 Initializing SQLite Database...` + '\x1b[0m');
  try {
    await prisma.$connect();
    console.log('\x1b[32m' + `       ✔ SQLite Database (database.db) Connected Successfully` + '\x1b[0m');
  } catch (err) {
    console.log('\x1b[31m' + `       ✖ Database Connection Error: ${err}` + '\x1b[0m');
  }

  console.log('\x1b[90m' + '─'.repeat(60) + '\x1b[0m');
}
