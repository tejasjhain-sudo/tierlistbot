// Production wrapper — runs TypeScript source directly via tsx (no build step needed).
const { execFileSync } = require('child_process');
const path = require('path');

const tsx = path.join(__dirname, 'node_modules', '.bin', 'tsx');
execFileSync(tsx, ['src/index.ts'], { stdio: 'inherit', env: process.env });
