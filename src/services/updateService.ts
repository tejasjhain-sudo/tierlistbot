import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

const GITHUB_REPO = 'tejasjhain-sudo/tierlistbot';
const RAW_PACKAGE_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json`;
const API_COMMITS_URL = `https://api.github.com/repos/${GITHUB_REPO}/commits/main`;

export interface UpdateStatus {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  currentCommit: string;
  latestCommit: string;
  commitMessage?: string;
  error?: string;
}

const ROOT_DIR = path.resolve(__dirname, '../../');

function getLocalVersion(): string {
  try {
    const pkgPath = path.join(ROOT_DIR, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return pkg.version || '1.0.0';
    }
  } catch {}
  return '1.0.0';
}

function getLocalCommit(): string {
  try {
    if (fs.existsSync(path.join(ROOT_DIR, '.git'))) {
      const head = fs.readFileSync(path.join(ROOT_DIR, '.git/HEAD'), 'utf8').trim();
      if (head.startsWith('ref:')) {
        const refPath = path.join(ROOT_DIR, '.git', head.substring(5).trim());
        if (fs.existsSync(refPath)) {
          return fs.readFileSync(refPath, 'utf8').trim().substring(0, 7);
        }
      } else {
        return head.substring(0, 7);
      }
    }
  } catch {}
  return 'Production';
}

/**
 * Check if a new version or commit is available on GitHub
 */
export async function checkGitUpdates(): Promise<UpdateStatus> {
  const currentVersion = getLocalVersion();
  const currentCommit = getLocalCommit();

  try {
    const [rawPkgRes, commitRes] = await Promise.all([
      fetch(RAW_PACKAGE_URL, { headers: { 'User-Agent': 'RearMC-AutoUpdater' } }),
      fetch(API_COMMITS_URL, { headers: { 'User-Agent': 'RearMC-AutoUpdater' } }),
    ]);

    let latestVersion = currentVersion;
    let latestCommit = currentCommit;
    let commitMessage = '';

    if (rawPkgRes.ok) {
      const rawPkg: any = await rawPkgRes.json();
      if (rawPkg.version) latestVersion = rawPkg.version;
    }

    if (commitRes.ok) {
      const commitData: any = await commitRes.json();
      if (commitData.sha) latestCommit = commitData.sha.substring(0, 7);
      if (commitData.commit?.message) commitMessage = commitData.commit.message;
    }

    const hasUpdate =
      latestVersion !== currentVersion ||
      (currentCommit !== 'Production' && latestCommit !== 'Production' && latestCommit !== currentCommit);

    return {
      hasUpdate,
      currentVersion,
      latestVersion,
      currentCommit,
      latestCommit,
      commitMessage,
    };
  } catch (err: any) {
    return {
      hasUpdate: false,
      currentVersion,
      latestVersion: currentVersion,
      currentCommit,
      latestCommit: currentCommit,
      error: err.message || String(err),
    };
  }
}

/**
 * Perform git pull or download update, npm install, and npm run build
 */
export async function performGitUpdate(): Promise<{ success: boolean; logs: string; error?: string }> {
  try {
    const logs: string[] = [];

    // 1. Ensure git repository is initialized
    if (!fs.existsSync(path.join(ROOT_DIR, '.git'))) {
      try {
        await execAsync(`git init && git remote add origin https://github.com/${GITHUB_REPO}.git`, { cwd: ROOT_DIR });
      } catch {}
    }

    // 2. Pull latest code from GitHub
    try {
      const { stdout: pullOut, stderr: pullErr } = await execAsync(
        `git fetch origin main && git reset --hard origin/main`,
        { cwd: ROOT_DIR }
      );
      logs.push(`[git pull]\n${pullOut || pullErr}`);
    } catch (gitErr: any) {
      try {
        const { stdout: pullOut } = await execAsync(`git pull origin main --force`, { cwd: ROOT_DIR });
        logs.push(`[git pull fallback]\n${pullOut}`);
      } catch (fallbackErr: any) {
        logs.push(`[git warning]\n${fallbackErr.message || String(fallbackErr)}`);
      }
    }

    // 3. Install production dependencies (including typescript and prisma)
    try {
      const { stdout: installOut } = await execAsync('npm install --no-audit --no-fund', { cwd: ROOT_DIR });
      logs.push(`[npm install]\n${installOut}`);
    } catch (installErr: any) {
      logs.push(`[npm install warning]\n${installErr.message || String(installErr)}`);
    }

    // 4. Rebuild TypeScript using local bin or npx
    try {
      const { stdout: buildOut } = await execAsync('npx tsc || ./node_modules/.bin/tsc || npm run build', { cwd: ROOT_DIR });
      logs.push(`[tsc build]\n${buildOut || 'Build succeeded'}`);
    } catch (buildErr: any) {
      const errMsg = buildErr.stderr || buildErr.stdout || buildErr.message || 'Compilation failed';
      throw new Error(`TypeScript build error: ${errMsg}`);
    }

    return {
      success: true,
      logs: logs.join('\n\n'),
    };
  } catch (err: any) {
    return {
      success: false,
      logs: '',
      error: err.stderr || err.stdout || err.message || String(err),
    };
  }
}
