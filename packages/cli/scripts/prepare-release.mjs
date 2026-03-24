#!/usr/bin/env bun

import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RELEASE_TARGETS } from './release-targets.mjs';
import { resolveExplicitTargets, resolveReleaseScope } from './release-args';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(packageRoot, '..', '..');
const resolvePathOverride = (value, fallback) => path.resolve(value || fallback);
const releaseRoot = resolvePathOverride(process.env.RENX_RELEASE_ROOT, path.join(packageRoot, 'release'));
const mainRoot = path.join(releaseRoot, 'main');
const platformsRoot = path.join(releaseRoot, 'platforms');
const bunInstallCacheDir = resolvePathOverride(
  process.env.RENX_BUN_INSTALL_CACHE_DIR || process.env.BUN_INSTALL_CACHE_DIR,
  path.join(workspaceRoot, '.bun-cache')
);
const packageJsonPath = path.join(packageRoot, 'package.json');
const readmePath = path.join(packageRoot, 'README.md');
const wrapperPath = path.join(packageRoot, 'bin', 'renx.cjs');
const ripgrepManifestPath = path.join(packageRoot, 'bin', 'rg');
const ripgrepInstallScriptPath = path.join(packageRoot, 'scripts', 'install-ripgrep.mjs');
const entryPath = path.join(packageRoot, 'src', 'index.tsx');

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version ?? '0.0.0';
const description = packageJson.description ?? 'Renx Code terminal AI coding assistant';
const args = process.argv.slice(2);
const releaseScope = resolveReleaseScope(args);
const singleTarget = args.includes('--single');
const allTargets = args.includes('--all');
const skipInstall = args.includes('--skip-install');

const run = (command, commandArgs, cwd = packageRoot, env = process.env) => {
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: 'inherit',
    env,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${result.status ?? 1}`);
  }
};

const ensureRequiredInputs = () => {
  mkdirSync(bunInstallCacheDir, { recursive: true });
  process.env.BUN_INSTALL_CACHE_DIR = bunInstallCacheDir;

  const requiredPaths = [readmePath, wrapperPath, ripgrepManifestPath, ripgrepInstallScriptPath, entryPath];
  for (const candidate of requiredPaths) {
    if (!existsSync(candidate)) {
      throw new Error(`Required release input is missing: ${candidate}`);
    }
  }
};

const resolveSelectedTargets = () => {
  const explicitTargets = resolveExplicitTargets(args);

  if (singleTarget && explicitTargets.length > 0) {
    throw new Error('Cannot combine --single with --target.');
  }

  if (releaseScope === 'main-only' && explicitTargets.length > 0) {
    throw new Error('Cannot combine --main-only with --target.');
  }

  if (releaseScope === 'platform-only' && explicitTargets.length === 0) {
    throw new Error('Missing --target for --platform-only.');
  }

  if (releaseScope === 'main-only') {
    return [];
  }

  if (allTargets) {
    return RELEASE_TARGETS;
  }

  const requestedIds =
    explicitTargets.length > 0
      ? explicitTargets
      : process.env.RENX_RELEASE_TARGETS?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];

  if (requestedIds.length > 0) {
    return requestedIds.map((id) => {
      const target = RELEASE_TARGETS.find((entry) => entry.id === id);
      if (!target) {
        throw new Error(`Unknown release target: ${id}`);
      }
      return target;
    });
  }

  if (releaseScope === 'platform-only') {
    throw new Error('Missing --target for --platform-only.');
  }

  const currentTarget = RELEASE_TARGETS.find(
    (target) => target.os === process.platform && target.cpu === process.arch
  );
  if (!currentTarget) {
    throw new Error(`No bundled release target is configured for ${process.platform}/${process.arch}.`);
  }
  return [currentTarget];
};



const installBuildDependencies = async () => {
  if (skipInstall) {
    return;
  }

  const openTuiVersion = packageJson.dependencies?.['@opentui/core'];
  if (!openTuiVersion) {
    throw new Error('Missing @opentui/core dependency version in package.json');
  }

  run(
    'bun',
    [
      'install',
      '--cwd',
      workspaceRoot,
      '--filter',
      packageJson.name,
      '--os=*',
      '--cpu=*',
      '--no-save',
      '--ignore-scripts',
      `@opentui/core@${openTuiVersion}`,
    ],
    workspaceRoot,
    {
      ...process.env,
      BUN_INSTALL_CACHE_DIR: bunInstallCacheDir,
    }
  );
};

const resolveParserWorkerPath = () => {
  const candidate = path.join(packageRoot, 'node_modules', '@opentui', 'core', 'parser.worker.js');
  if (!existsSync(candidate)) {
    throw new Error(`Cannot find OpenTUI parser worker at ${candidate}`);
  }
  return fs.realpathSync(candidate);
};

const prepareMainPackage = () => {
  mkdirSync(path.join(mainRoot, 'bin'), { recursive: true });
  cpSync(wrapperPath, path.join(mainRoot, 'bin', 'renx.cjs'));
  cpSync(readmePath, path.join(mainRoot, 'README.md'));
  chmodSync(path.join(mainRoot, 'bin', 'renx.cjs'), 0o755);

  const mainPackageJson = {
    name: packageJson.name,
    version,
    description,
    type: 'commonjs',
    private: false,
    bin: {
      renx: './bin/renx.cjs',
    },
    files: ['bin', 'README.md'],
    optionalDependencies: Object.fromEntries(
      RELEASE_TARGETS.map((target) => [target.packageName, version])
    ),
    engines: packageJson.engines,
    keywords: packageJson.keywords,
  };

  writeFileSync(path.join(mainRoot, 'package.json'), `${JSON.stringify(mainPackageJson, null, 2)}\n`);
};

const compileTargetScriptPath = path.join(packageRoot, 'scripts', 'compile-release-target.mjs');

const preparePlatformPackage = async (target, parserWorkerPath) => {
  const targetRoot = path.join(platformsRoot, target.id);
  const binaryOutputPath = path.join(targetRoot, 'bin', target.binaryName);

  mkdirSync(path.join(targetRoot, 'bin'), { recursive: true });
  mkdirSync(path.join(targetRoot, 'scripts'), { recursive: true });

  run(
    'bun',
    [compileTargetScriptPath, target.id, binaryOutputPath, parserWorkerPath, version],
    packageRoot,
    {
      ...process.env,
      BUN_INSTALL_CACHE_DIR: bunInstallCacheDir,
    }
  );

  cpSync(readmePath, path.join(targetRoot, 'README.md'));
  cpSync(ripgrepManifestPath, path.join(targetRoot, 'bin', 'rg'));
  cpSync(ripgrepInstallScriptPath, path.join(targetRoot, 'scripts', 'install-ripgrep.mjs'));

  if (target.os !== 'win32') {
    chmodSync(binaryOutputPath, 0o755);
  }

  const targetPackageJson = {
    name: target.packageName,
    version,
    description: `${description} (${target.id})`,
    type: 'commonjs',
    private: false,
    os: [target.os],
    cpu: [target.cpu],
    bin: {
      renx: `./bin/${target.binaryName}`,
    },
    files: ['bin', 'scripts', 'README.md'],
    scripts: {
      postinstall: 'node ./scripts/install-ripgrep.mjs',
    },
    engines: packageJson.engines,
  };

  writeFileSync(path.join(targetRoot, 'package.json'), `${JSON.stringify(targetPackageJson, null, 2)}\n`);
};

try {
  ensureRequiredInputs();
  const selectedTargets = resolveSelectedTargets();
  if (selectedTargets.length > 0) {
    await installBuildDependencies();
    run('pnpm', ['--dir', workspaceRoot, '--filter', '@renx-code/core', 'build'], workspaceRoot);
  }

  rmSync(releaseRoot, { recursive: true, force: true });
  mkdirSync(mainRoot, { recursive: true });
  mkdirSync(platformsRoot, { recursive: true });

  prepareMainPackage();

  if (selectedTargets.length > 0) {
    const parserWorkerPath = resolveParserWorkerPath();
    for (const target of selectedTargets) {
      console.log(`building ${target.packageName}`);
      await preparePlatformPackage(target, parserWorkerPath);
    }
  }

  console.log(`Prepared multi-platform release directory at ${releaseRoot}`);
  console.log(`Main package: ${packageJson.name}@${version}`);
  if (selectedTargets.length > 0) {
    console.log(`Platform packages: ${selectedTargets.map((target) => target.packageName).join(', ')}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
