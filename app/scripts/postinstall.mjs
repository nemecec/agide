// Runs after `pnpm install`: downloads the Electron binary and repairs the node-pty prebuild.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

// Electron 45 no longer downloads its binary in an install script; its `install-electron` bin does.
execFileSync(process.execPath, [require.resolve('electron/install.js')], { stdio: 'inherit' });

// node-pty 1.1.0 publishes `spawn-helper` without the executable bit, and every spawn then fails
// with "posix_spawnp failed".
const ptyRoot = dirname(require.resolve('node-pty/package.json'));
const helper = join(ptyRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
if (existsSync(helper)) chmodSync(helper, 0o755);
