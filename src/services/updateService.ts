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
    // 1. Fetch remote package.json and latest commit via HTTPS
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

    // Determine if update is available
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

    // Ensure git is configured if .git is missing
    if (!fs.existsSync(path.join(ROOT_DIR, '.git'))) {
      try {
        await execAsync(`git init && git remote add origin https://github.com/${GITHUB_REPO}.git`, { cwd: ROOT_DIR });
      } catch {}
    }

    // 1. Pull latest commits from GitHub
    try {
      const { stdout: pullOut, stderr: pullErr } = await execAsync(
        `git fetch origin main && git reset --hard origin/main`,
        { cwd: ROOT_DIR }
      );
      logs.push(`[git pull]\n${pullOut || pullErr}`);
    } catch (gitErr: any) {
      // Fallback: git pull
      const { stdout: pullOut } = await execAsync(`git pull origin main --force || git pull`, { cwd: ROOT_DIR });
      logs.push(`[git pull]\n${pullOut}`);
    }

    // 2. Install dependencies
    const { stdout: installOut } = await execAsync('npm install --no-audit --no-fund', { cwd: ROOT_DIR });
    logs.push(`[npm install]\n${installOut}`);

    // 3. Rebuild TypeScript
    const { stdout: buildOut } = await execAsync('npm run build', { cwd: ROOT_DIR });
    logs.push(`[npm run build]\n${buildOut || 'Build completed successfully.'}`);

    return {
      success: true,
      logs: logs.join('\n\n'),
    };
  } catch (err: any) {
    return {
      success: false,
      logs: '',
      error: err.message || String(err),
    };
  }
}
