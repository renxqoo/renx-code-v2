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

const tagIndex = process.argv.indexOf('--tag');
const tag = tagIndex >= 0 ? process.argv[tagIndex + 1] : undefined;

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

const publish = (packageDir) => {
  const args = ['publish', packageDir, '--access', 'public'];
  if (tag) {
    args.push('--tag', tag);
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
};

const platformDirs = RELEASE_TARGETS.map((target) => path.join(releaseRoot, 'platforms', target.id))
  .filter((packageDir) => existsSync(path.join(packageDir, 'package.json')));
const mainDir = path.join(releaseRoot, 'main');

if (platformDirs.length === 0 && !existsSync(path.join(mainDir, 'package.json'))) {
  throw new Error('No release packages found. Run `pnpm run release:prepare` first.');
}

for (const packageDir of platformDirs) {
  publish(packageDir);
}
if (existsSync(path.join(mainDir, 'package.json'))) {
  publish(mainDir);
}
