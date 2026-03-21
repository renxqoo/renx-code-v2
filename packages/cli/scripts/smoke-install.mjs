#!/usr/bin/env node

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveReleaseTarget } from './release-targets.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const releaseRoot = path.join(packageRoot, 'release');
const mainPackageRoot = path.join(releaseRoot, 'main');
const currentTarget = resolveReleaseTarget(process.platform, process.arch);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!currentTarget) {
  throw new Error(`No release target configured for ${process.platform}/${process.arch}.`);
}

const platformPackageRoot = path.join(releaseRoot, 'platforms', currentTarget.id);
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'renx-cli-smoke-'));
const prefixDir = path.join(tempRoot, 'prefix');
const npmCacheDir = path.join(tempRoot, 'npm-cache');
const binaryCacheDir = path.join(tempRoot, 'binary-cache');

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

function run(command, args, options = {}) {
  const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
  const result = spawnSync(command, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    env: buildNpmEnv(),
    shell: useShell,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stdout = result.stdout?.trim();
    const stderr = result.stderr?.trim();
    const details = [stdout, stderr].filter(Boolean).join('\n');
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}${details ? `\n${details}` : ''}`
    );
  }

  return result;
}

async function ensureReleasePackage(dir) {
  const manifestPath = path.join(dir, 'package.json');
  try {
    await fs.access(manifestPath);
  } catch {
    throw new Error(
      `Missing release package at ${dir}. Run \`pnpm --filter @renxqoo/renx-code release:prepare\` first.`
    );
  }
}

function packPackage(packageDir) {
  const result = run(npmCommand, ['pack', packageDir, '--json'], {
    cwd: tempRoot,
  });
  const parsed = JSON.parse(result.stdout);
  const filename = parsed?.[0]?.filename;
  if (!filename) {
    throw new Error(`npm pack did not return an archive name for ${packageDir}`);
  }
  return path.join(tempRoot, filename);
}

function resolveInstalledCommand() {
  if (process.platform === 'win32') {
    return path.join(prefixDir, 'renx.cmd');
  }

  return path.join(prefixDir, 'bin', 'renx');
}

async function findCachedBinary(root) {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.name === (process.platform === 'win32' ? 'renx.exe' : 'renx')) {
        return fullPath;
      }
    }
  }

  return null;
}

async function main() {
  try {
    await ensureReleasePackage(mainPackageRoot);
    await ensureReleasePackage(platformPackageRoot);

    const platformTgz = packPackage(platformPackageRoot);
    const mainTgz = packPackage(mainPackageRoot);

    await fs.mkdir(prefixDir, { recursive: true });
    await fs.mkdir(npmCacheDir, { recursive: true });
    await fs.mkdir(binaryCacheDir, { recursive: true });

    run(
      npmCommand,
      ['install', '-g', '--prefix', prefixDir, '--no-fund', '--no-audit', platformTgz, mainTgz],
      { cwd: tempRoot }
    );

    const commandPath = resolveInstalledCommand();
    const commandEnv = {
      ...buildNpmEnv(),
      RENX_BINARY_CACHE_DIR: binaryCacheDir,
    };

    const versionResult = run(commandPath, ['--version'], {
      cwd: tempRoot,
      env: commandEnv,
    });
    const installedVersion = versionResult.stdout.trim();
    const expectedVersion = JSON.parse(
      await fs.readFile(path.join(mainPackageRoot, 'package.json'), 'utf8')
    ).version;
    if (installedVersion !== expectedVersion) {
      throw new Error(`Expected renx version ${expectedVersion}, got ${installedVersion}`);
    }

    const helpResult = run(commandPath, ['--help'], {
      cwd: tempRoot,
      env: commandEnv,
    });
    if (!helpResult.stdout.includes('Usage:')) {
      throw new Error('Installed renx command did not print usage help.');
    }

    const cachedBinary = await findCachedBinary(binaryCacheDir);
    if (!cachedBinary) {
      throw new Error(`Expected cached binary under ${binaryCacheDir}, but none was created.`);
    }

    run(
      npmCommand,
      ['install', '-g', '--prefix', prefixDir, '--no-fund', '--no-audit', platformTgz, mainTgz],
      { cwd: tempRoot }
    );

    console.log(`Smoke install succeeded for ${currentTarget.packageName}`);
    console.log(`Installed command: ${commandPath}`);
    console.log(`Cached binary: ${cachedBinary}`);
  } finally {
    if (process.env.RENX_SMOKE_KEEP_TEMP !== '1') {
      rmSync(tempRoot, { recursive: true, force: true });
    } else {
      console.log(`Retained smoke temp directory at ${tempRoot}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
