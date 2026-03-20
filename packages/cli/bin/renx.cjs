#!/usr/bin/env node

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..');
const binaryName = process.platform === 'win32' ? 'renx.exe' : 'renx';
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const cliArgs = process.argv.slice(2);
const platformPackageMap = {
  'darwin:arm64': {
    id: 'darwin-arm64',
    packageName: '@renxqoo/renx-code-darwin-arm64',
    binaryName: 'renx',
  },
  'darwin:x64': {
    id: 'darwin-x64',
    packageName: '@renxqoo/renx-code-darwin-x64',
    binaryName: 'renx',
  },
  'linux:arm64': {
    id: 'linux-arm64',
    packageName: '@renxqoo/renx-code-linux-arm64',
    binaryName: 'renx',
  },
  'linux:x64': {
    id: 'linux-x64',
    packageName: '@renxqoo/renx-code-linux-x64',
    binaryName: 'renx',
  },
  'win32:x64': {
    id: 'win32-x64',
    packageName: '@renxqoo/renx-code-win32-x64',
    binaryName: 'renx.exe',
  },
};

if (cliArgs.includes('-v') || cliArgs.includes('--version')) {
  console.log(packageJson.version || '0.0.0');
  process.exit(0);
}

function run(target, args, env = process.env) {
  const result = childProcess.spawnSync(target, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(typeof result.status === 'number' ? result.status : 0);
}

function getBundledRipgrepEnv(binaryPackageRoot, baseEnv = process.env) {
  const targetByPlatform = {
    'darwin:arm64': 'aarch64-apple-darwin',
    'darwin:x64': 'x86_64-apple-darwin',
    'linux:arm64': 'aarch64-unknown-linux-musl',
    'linux:x64': 'x86_64-unknown-linux-musl',
    'win32:arm64': 'aarch64-pc-windows-msvc',
    'win32:x64': 'x86_64-pc-windows-msvc',
  };
  const target = targetByPlatform[`${process.platform}:${process.arch}`];
  if (!target) {
    return {};
  }

  const dir = path.join(binaryPackageRoot, 'vendor', 'ripgrep', target, 'path');
  const binary = path.join(dir, process.platform === 'win32' ? 'rg.exe' : 'rg');
  if (!fs.existsSync(binary)) {
    return {};
  }

  return {
    RENX_BUNDLED_RG_DIR: baseEnv.RENX_BUNDLED_RG_DIR || dir,
    RIPGREP_PATH: baseEnv.RIPGREP_PATH || binary,
  };
}

function resolveBunExecutable() {
  if (process.env.RENX_BUN_PATH) {
    return process.env.RENX_BUN_PATH;
  }

  const candidates = process.platform === 'win32' ? ['bun.exe', 'bun.cmd', 'bun'] : ['bun'];

  for (const candidate of candidates) {
    const probe = childProcess.spawnSync(candidate, ['--version'], {
      stdio: 'ignore',
    });

    if (!probe.error && probe.status === 0) {
      return candidate;
    }
  }

  return null;
}

function hasAgentSourceRoot(root) {
  return (
    fs.existsSync(path.join(root, 'packages', 'core', 'src', 'providers', 'index.ts')) &&
    fs.existsSync(path.join(root, 'packages', 'core', 'src', 'config', 'index.ts')) &&
    fs.existsSync(path.join(root, 'packages', 'core', 'src', 'agent', 'app', 'index.ts'))
  );
}

function resolveInstalledPlatformPackageCandidate() {
  const platformPackage = platformPackageMap[`${process.platform}:${process.arch}`];
  if (!platformPackage) {
    return null;
  }

  try {
    const packageJsonPath = require.resolve(`${platformPackage.packageName}/package.json`, {
      paths: [packageRoot],
    });
    const binaryPackageRoot = path.dirname(packageJsonPath);
    const candidate = path.join(binaryPackageRoot, 'bin', platformPackage.binaryName);
    if (!fs.existsSync(candidate)) {
      return null;
    }
    return {
      candidate,
      binaryPackageRoot,
    };
  } catch {
    return null;
  }
}

function resolveLocalReleaseCandidate() {
  const platformPackage = platformPackageMap[`${process.platform}:${process.arch}`];
  if (!platformPackage) {
    return null;
  }

  const localRoots = [
    path.join(packageRoot, 'release', 'platforms', platformPackage.id),
    path.resolve(packageRoot, '..', 'platforms', platformPackage.id),
  ];

  for (const binaryPackageRoot of localRoots) {
    const candidate = path.join(binaryPackageRoot, 'bin', platformPackage.binaryName);
    if (fs.existsSync(candidate)) {
      return {
        candidate,
        binaryPackageRoot,
      };
    }
  }

  return null;
}

const binaryCandidates = [
  process.env.RENX_BIN_PATH
    ? {
        candidate: process.env.RENX_BIN_PATH,
        binaryPackageRoot: packageRoot,
      }
    : null,
  {
    candidate: path.join(__dirname, binaryName),
    binaryPackageRoot: packageRoot,
  },
  resolveLocalReleaseCandidate(),
  resolveInstalledPlatformPackageCandidate(),
].filter(Boolean);

for (const entry of binaryCandidates) {
  if (fs.existsSync(entry.candidate)) {
    run(entry.candidate, cliArgs, {
      ...process.env,
      RENX_VERSION: process.env.RENX_VERSION || packageJson.version || '0.0.0',
      ...getBundledRipgrepEnv(entry.binaryPackageRoot, process.env),
    });
  }
}

const sourceEntry = path.join(packageRoot, 'src', 'index.tsx');
if (fs.existsSync(sourceEntry)) {
  const packagedRepoRoot = path.join(packageRoot, 'vendor', 'agent-root');
  const localRepoRoot = path.resolve(packageRoot, '..', '..');
  const resolvedRepoRoot =
    process.env.AGENT_REPO_ROOT ||
    (hasAgentSourceRoot(packagedRepoRoot)
      ? packagedRepoRoot
      : hasAgentSourceRoot(localRepoRoot)
        ? localRepoRoot
        : undefined);
  const bunExecutable = resolveBunExecutable();

  if (bunExecutable) {
    run(bunExecutable, ['run', sourceEntry, ...cliArgs], {
      ...process.env,
      RENX_VERSION: process.env.RENX_VERSION || packageJson.version || '0.0.0',
      AGENT_WORKDIR: process.env.AGENT_WORKDIR || process.cwd(),
      ...(resolvedRepoRoot ? { AGENT_REPO_ROOT: resolvedRepoRoot } : {}),
      ...getBundledRipgrepEnv(packageRoot, process.env),
    });
  }
}

if (!platformPackageMap[`${process.platform}:${process.arch}`]) {
  console.error(
    `Renx does not currently ship a native binary for ${process.platform}/${process.arch}.`
  );
  console.error(
    'Currently bundled targets are: darwin/arm64, darwin/x64, linux/arm64, linux/x64, win32/x64.'
  );
}

console.error(`Could not find Renx executable: expected ${binaryName} next to ${__filename}.`);
console.error(
  'Run `npm run release:prepare` to build local release artifacts, or set RENX_BIN_PATH.'
);
process.exit(1);
