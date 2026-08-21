import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

export interface UpdateStatus {
  hasUpdate: boolean;
  currentCommit: string;
  latestCommit: string;
  commitMessage?: string;
  error?: string;
}

const ROOT_DIR = path.resolve(__dirname, '../../');

/**
 * Check if a new commit is available on the remote git branch
 */
export async function checkGitUpdates(): Promise<UpdateStatus> {
  try {
    // 1. Fetch latest changes from remote
    await execAsync('git fetch origin', { cwd: ROOT_DIR });

    // 2. Get local HEAD commit hash
    const { stdout: localHash } = await execAsync('git rev-parse HEAD', { cwd: ROOT_DIR });

    // 3. Get remote upstream commit hash
    const { stdout: remoteHash } = await execAsync('git rev-parse @{u}', { cwd: ROOT_DIR });

    const currentCommit = localHash.trim().substring(0, 7);
    const latestCommit = remoteHash.trim().substring(0, 7);

    if (currentCommit === latestCommit) {
      return {
        hasUpdate: false,
        currentCommit,
        latestCommit,
      };
    }

    // Get commit message of latest commit
    const { stdout: commitMsg } = await execAsync('git log -1 --pretty=%B @{u}', { cwd: ROOT_DIR });

    return {
      hasUpdate: true,
      currentCommit,
      latestCommit,
      commitMessage: commitMsg.trim(),
    };
  } catch (err: any) {
    return {
      hasUpdate: false,
      currentCommit: 'unknown',
      latestCommit: 'unknown',
      error: err.message || String(err),
    };
  }
}

/**
 * Perform git pull, npm install, and npm run build
 */
export async function performGitUpdate(): Promise<{ success: boolean; logs: string; error?: string }> {
  try {
    const logs: string[] = [];

    // 1. Pull latest commits
    const { stdout: pullOut, stderr: pullErr } = await execAsync('git pull', { cwd: ROOT_DIR });
    logs.push(`[git pull]\n${pullOut || pullErr}`);

    // 2. Install dependencies if package.json changed
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
