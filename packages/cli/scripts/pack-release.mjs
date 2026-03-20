#!/usr/bin/env bun

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RELEASE_TARGETS } from './release-targets.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const releaseRoot = path.join(packageRoot, 'release');
const dryRun = process.argv.includes('--dry-run');

const buildNpmEnv = () => {
  const env = {
    ...process.env,
    NPM_CONFIG_CACHE: path.join(packageRoot, '.npm-cache'),
  };

  for (const key of Object.keys(env)) {
    const normalized = key.toLowerCase();
    if (
      normalized === 'npm_config_recursive' ||
      normalized === 'npm_config_verify_deps_before_run' ||
      normalized === 'npm_config__jsr_registry' ||
      normalized === 'npm_config_enable_pre_post_scripts' ||
      normalized === 'npm_config_store_dir'
    ) {
      delete env[key];
    }
  }

  return env;
};

const packageDirs = [
  ...RELEASE_TARGETS.map((target) => path.join(releaseRoot, 'platforms', target.id)),
  path.join(releaseRoot, 'main'),
].filter((packageDir) => existsSync(path.join(packageDir, 'package.json')));

if (packageDirs.length === 0) {
  throw new Error('No release packages found. Run `pnpm run release:prepare` first.');
}

for (const packageDir of packageDirs) {
  const args = ['pack', packageDir];
  if (dryRun) {
    args.push('--dry-run');
  }

  const result = spawnSync('npm', args, {
    cwd: releaseRoot,
    stdio: 'inherit',
    env: buildNpmEnv(),
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status ?? 1}`);
  }
}
