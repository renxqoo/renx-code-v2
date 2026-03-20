#!/usr/bin/env bun

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RELEASE_TARGETS } from './release-targets.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(packageRoot, '..', '..');
const releaseRoot = path.join(packageRoot, 'release');
const mainRoot = path.join(releaseRoot, 'main');
const platformsRoot = path.join(releaseRoot, 'platforms');
const packageJsonPath = path.join(packageRoot, 'package.json');
const readmePath = path.join(packageRoot, 'README.md');
const wrapperPath = path.join(packageRoot, 'bin', 'renx.cjs');
const ripgrepManifestPath = path.join(packageRoot, 'bin', 'rg');
const ripgrepInstallScriptPath = path.join(packageRoot, 'scripts', 'install-ripgrep.mjs');
const entryPath = path.join(packageRoot, 'src', 'index.tsx');
const stagedAssetsRoot = path.join(packageRoot, '.release-assets');
const stagedNodeModulesRoot = path.join(stagedAssetsRoot, 'node_modules');
const stagedWebTreeSitterRoot = path.join(stagedNodeModulesRoot, 'web-tree-sitter');
const parserWorkerPath = path.join(stagedAssetsRoot, 'parser.worker.js');

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version ?? '0.0.0';
const description = packageJson.description ?? 'Renx Code terminal AI coding assistant';
const args = process.argv.slice(2);
const mainOnly = args.includes('--main-only');
const platformOnly = args.includes('--platform-only');
const allTargets = args.includes('--all');

if (mainOnly && platformOnly) {
  throw new Error('Cannot use --main-only and --platform-only together.');
}

const run = (command, args, cwd = workspaceRoot) => {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}`);
  }
};

const resolveParserWorkerSourcePath = () => {
  const directCandidates = [
    path.join(packageRoot, 'node_modules', '@opentui', 'core', 'parser.worker.js'),
    path.join(workspaceRoot, 'node_modules', '@opentui', 'core', 'parser.worker.js'),
  ];

  for (const candidate of directCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const pnpmStoreRoot = path.join(workspaceRoot, 'node_modules', '.pnpm');
  if (existsSync(pnpmStoreRoot)) {
    for (const entry of readdirSync(pnpmStoreRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('@opentui+core@')) {
        continue;
      }

      const candidate = path.join(
        pnpmStoreRoot,
        entry.name,
        'node_modules',
        '@opentui',
        'core',
        'parser.worker.js'
      );
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error(
    `Cannot find OpenTUI parser worker in installed dependencies under ${packageRoot} or ${workspaceRoot}`
  );
};

const resolveWebTreeSitterSourcePath = () => {
  const directCandidates = [
    path.join(packageRoot, 'node_modules', 'web-tree-sitter'),
    path.join(workspaceRoot, 'node_modules', 'web-tree-sitter'),
  ];

  for (const candidate of directCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const pnpmStoreRoot = path.join(workspaceRoot, 'node_modules', '.pnpm');
  if (existsSync(pnpmStoreRoot)) {
    for (const entry of readdirSync(pnpmStoreRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('web-tree-sitter@')) {
        continue;
      }

      const candidate = path.join(pnpmStoreRoot, entry.name, 'node_modules', 'web-tree-sitter');
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error(
    `Cannot find web-tree-sitter in installed dependencies under ${packageRoot} or ${workspaceRoot}`
  );
};

const stageParserWorker = () => {
  const sourcePath = resolveParserWorkerSourcePath();
  mkdirSync(stagedAssetsRoot, { recursive: true });
  cpSync(sourcePath, parserWorkerPath);
};

const stageWebTreeSitter = () => {
  const sourcePath = resolveWebTreeSitterSourcePath();
  mkdirSync(stagedNodeModulesRoot, { recursive: true });
  rmSync(stagedWebTreeSitterRoot, { recursive: true, force: true });
  cpSync(sourcePath, stagedWebTreeSitterRoot, { recursive: true });
};

const ensureReleaseInputs = () => {
  const requiredPaths = [readmePath, wrapperPath, ripgrepManifestPath, ripgrepInstallScriptPath, entryPath];
  for (const candidate of requiredPaths) {
    if (!existsSync(candidate)) {
      throw new Error(`Required release input is missing: ${candidate}`);
    }
  }
  stageParserWorker();
  stageWebTreeSitter();
  if (!existsSync(parserWorkerPath)) {
    throw new Error(`Cannot find staged OpenTUI parser worker: ${parserWorkerPath}`);
  }
  if (!existsSync(path.join(stagedWebTreeSitterRoot, 'package.json'))) {
    throw new Error(`Cannot find staged web-tree-sitter package: ${stagedWebTreeSitterRoot}`);
  }
};

const resolveSelectedTargets = () => {
  if (mainOnly) {
    return [];
  }

  if (allTargets) {
    return RELEASE_TARGETS;
  }

  const explicitTargets = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--target') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value for --target.');
      }
      explicitTargets.push(value);
      index += 1;
    }
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

  const currentTarget = RELEASE_TARGETS.find(
    (target) => target.os === process.platform && target.cpu === process.arch
  );
  if (!currentTarget) {
    throw new Error(
      `No bundled release target is configured for ${process.platform}/${process.arch}.`
    );
  }
  return [currentTarget];
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

const preparePlatformPackage = async (target) => {
  const targetRoot = path.join(platformsRoot, target.id);
  const binaryOutputPath = path.join(targetRoot, 'bin', target.binaryName);

  mkdirSync(path.join(targetRoot, 'bin'), { recursive: true });
  mkdirSync(path.join(targetRoot, 'scripts'), { recursive: true });

  const compile = {
    target: target.bunTarget,
    outfile: binaryOutputPath,
    execArgv: ['--'],
  };
  if (target.os === 'win32') {
    compile.windows = {};
  }

  const result = await Bun.build({
    entrypoints: [entryPath, parserWorkerPath],
    compile,
    define: {
      OTUI_TREE_SITTER_WORKER_PATH: JSON.stringify(
        `${target.os === 'win32' ? 'B:/~BUN/root/' : '/$bunfs/root/'}${path
          .relative(packageRoot, parserWorkerPath)
          .replaceAll('\\', '/')}`
      ),
      RENX_BUILD_VERSION: JSON.stringify(version),
    },
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log.message);
    }
    throw new Error(`Failed to compile target ${target.id}.`);
  }

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

  writeFileSync(
    path.join(targetRoot, 'package.json'),
    `${JSON.stringify(targetPackageJson, null, 2)}\n`
  );
};

ensureReleaseInputs();
const selectedTargets = resolveSelectedTargets();
if (selectedTargets.length > 0) {
  run('pnpm', ['--filter', '@renx-code/core', 'build']);
}
rmSync(releaseRoot, { recursive: true, force: true });
mkdirSync(mainRoot, { recursive: true });
mkdirSync(platformsRoot, { recursive: true });

if (!platformOnly) {
  prepareMainPackage();
}
for (const target of selectedTargets) {
  await preparePlatformPackage(target);
}

console.log(`Prepared multi-platform release directory at ${releaseRoot}`);
if (!platformOnly) {
  console.log(`Main package: ${packageJson.name}@${version}`);
}
if (selectedTargets.length > 0) {
  console.log(`Platform packages: ${selectedTargets.map((target) => target.packageName).join(', ')}`);
}
