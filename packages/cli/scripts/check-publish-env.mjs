#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';

const run = (command, args) =>
  spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'pipe',
    encoding: 'utf8',
  });

const whoami = run('npm', ['whoami']);
if (whoami.status !== 0) {
  const stderr = (whoami.stderr || '').trim();
  console.error('npm publish preflight failed: npm authentication is not available.');
  if (stderr) {
    console.error(stderr);
  }
  console.error('Run `npm login` or configure a valid `NPM_TOKEN`, then retry publish.');
  process.exit(1);
}

const user = (whoami.stdout || '').trim();
if (!user) {
  console.error('npm publish preflight failed: `npm whoami` returned no username.');
  process.exit(1);
}

console.log(`npm publish preflight OK: authenticated as ${user}`);
