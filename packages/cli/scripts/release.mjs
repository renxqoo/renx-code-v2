#!/usr/bin/env bun

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RELEASE_TARGETS } from './release-targets.mjs';
import {
  filterReleasePackageDirs,
  resolvePackArgs,
  resolvePrepareArgs,
  resolvePublishArgs,
  resolveReleaseScope,
} from './release-args';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const resolvePathOverride = (value, fallback) => path.resolve(value || fallback);
const releaseRoot = resolvePathOverride(process.env.RENX_RELEASE_ROOT, path.join(packageRoot, 'release'));
const prepareScriptPath = path.join(packageRoot, 'scripts', 'prepare-release.mjs');
const npmCacheDir = resolvePathOverride(process.env.RENX_NPM_CACHE_DIR, path.join(packageRoot, '.npm-cache'));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const bunCommand = process.platform === 'win32' ? 'bun.exe' : 'bun';

const command = process.argv[2];
const args = process.argv.slice(3);

const buildNpmEnv = () => {
  const env = {
    ...process.env,
    NPM_CONFIG_CACHE: npmCacheDir,
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

const run = (commandName, commandArgs, options = {}) => {
  const result = spawnSync(commandName, commandArgs, {
    cwd: options.cwd ?? releaseRoot,
    stdio: options.stdio ?? 'inherit',
    encoding: options.encoding ?? 'utf8',
    env: options.env ?? process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `${commandName} ${commandArgs.join(' ')} failed with exit code ${result.status ?? 1}`
    );
  }

  return result;
};

const resolveReleasePackageDirs = () =>
  [
    ...RELEASE_TARGETS.map((target) => path.join(releaseRoot, 'platforms', target.id)),
    path.join(releaseRoot, 'main'),
  ].filter((packageDir) => existsSync(path.join(packageDir, 'package.json')));

const runPrepare = (prepareArgs) => {
  run(bunCommand, [prepareScriptPath, ...prepareArgs], {
    cwd: packageRoot,
  });
};

const runPreflight = () => {
  const whoami = spawnSync(npmCommand, ['whoami'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    encoding: 'utf8',
  });

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
};

const runPack = (commandArgs) => {
  const scope = resolveReleaseScope(commandArgs);
  const prepareArgs = resolvePrepareArgs(commandArgs);
  const packArgs = resolvePackArgs(commandArgs);

  runPrepare(prepareArgs);

  const packageDirs = filterReleasePackageDirs(resolveReleasePackageDirs(), scope);
  if (packageDirs.length === 0) {
    throw new Error('No release packages found after prepare.');
  }

  for (const packageDir of packageDirs) {
    run(npmCommand, ['pack', packageDir, ...packArgs], {
      cwd: releaseRoot,
      env: buildNpmEnv(),
    });
  }
};

const runPublish = (commandArgs) => {
  runPreflight();

  const scope = resolveReleaseScope(commandArgs);
  const prepareArgs = resolvePrepareArgs(commandArgs);
  const publishArgs = resolvePublishArgs(commandArgs);

  runPrepare(prepareArgs);

  const packageDirs = filterReleasePackageDirs(resolveReleasePackageDirs(), scope);
  if (packageDirs.length === 0) {
    throw new Error('No release packages found after prepare.');
  }

  for (const packageDir of packageDirs) {
    run(npmCommand, ['publish', packageDir, '--access', 'public', ...publishArgs], {
      cwd: releaseRoot,
    });
  }
};


switch (command) {
  case 'preflight':
    runPreflight();
    break;
  case 'pack':
    runPack(args);
    break;
  case 'publish':
    runPublish(args);
    break;
  default:
    console.error(
      'Usage: bun ./scripts/release.mjs <preflight|pack|publish> [--platform-only|--main-only] [--target <id>] [--skip-install] [--dry-run] [--tag <tag>] [--otp <otp>]'
    );
    process.exit(1);
}
