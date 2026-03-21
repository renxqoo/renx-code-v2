#!/usr/bin/env node

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
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

function resolveCacheRoot() {
  if (process.env.RENX_BINARY_CACHE_DIR) {
    return process.env.RENX_BINARY_CACHE_DIR;
  }

  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'Renx',
      'binary-cache'
    );
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'Renx', 'binary-cache');
  }

  return path.join(
    process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'),
    'renx',
    'binary-cache'
  );
}

function sanitizeCacheSegment(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function resolveBundledRipgrepLayout(binaryPackageRoot) {
  if (!binaryPackageRoot) {
    return null;
  }

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
    return null;
  }

  const dir = path.join(binaryPackageRoot, 'vendor', 'ripgrep', target, 'path');
  const binary = path.join(dir, process.platform === 'win32' ? 'rg.exe' : 'rg');
  return {
    dir,
    binary,
  };
}

function getBundledRipgrepEnv(baseEnv = process.env, ...binaryPackageRoots) {
  for (const binaryPackageRoot of binaryPackageRoots) {
    const layout = resolveBundledRipgrepLayout(binaryPackageRoot);
    if (!layout || !fs.existsSync(layout.binary)) {
      continue;
    }

    return {
      RENX_BUNDLED_RG_DIR: baseEnv.RENX_BUNDLED_RG_DIR || layout.dir,
      RIPGREP_PATH: baseEnv.RIPGREP_PATH || layout.binary,
    };
  }

  return {};
}

function copyBundledRipgrep(sourceBinaryPackageRoot, targetBinaryPackageRoot) {
  const sourceLayout = resolveBundledRipgrepLayout(sourceBinaryPackageRoot);
  const targetLayout = resolveBundledRipgrepLayout(targetBinaryPackageRoot);

  if (!sourceLayout || !targetLayout || !fs.existsSync(sourceLayout.binary)) {
    return;
  }

  fs.mkdirSync(path.dirname(targetLayout.dir), { recursive: true });
  fs.cpSync(sourceLayout.dir, targetLayout.dir, { recursive: true, force: true });
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

function buildBinaryCacheFingerprint(candidate, packageName) {
  const stats = fs.statSync(candidate);
  return crypto
    .createHash('sha256')
    .update(
      [
        packageName || '',
        packageJson.version || '0.0.0',
        process.platform,
        process.arch,
        candidate,
        String(stats.size),
        String(Math.trunc(stats.mtimeMs)),
      ].join('|')
    )
    .digest('hex')
    .slice(0, 16);
}

function materializeBinaryCandidate(entry) {
  if (
    process.env.RENX_DISABLE_BINARY_CACHE === '1' ||
    entry.skipCache ||
    !entry.binaryPackageRoot
  ) {
    return entry;
  }

  const packageName = entry.packageName || path.basename(entry.binaryPackageRoot);
  const version = packageJson.version || '0.0.0';
  const fingerprint = buildBinaryCacheFingerprint(entry.candidate, packageName);
  const cacheBase = path.join(
    resolveCacheRoot(),
    sanitizeCacheSegment(packageName),
    sanitizeCacheSegment(version)
  );
  const cachedBinaryPackageRoot = path.join(cacheBase, fingerprint);
  const cachedBinaryPath = path.join(
    cachedBinaryPackageRoot,
    'bin',
    path.basename(entry.candidate)
  );

  if (fs.existsSync(cachedBinaryPath)) {
    return {
      ...entry,
      candidate: cachedBinaryPath,
      binaryPackageRoot: cachedBinaryPackageRoot,
      fallbackBinaryPackageRoot: entry.binaryPackageRoot,
    };
  }

  const tempRoot = path.join(cacheBase, `.tmp-${fingerprint}-${process.pid}`);
  const tempBinaryPath = path.join(tempRoot, 'bin', path.basename(entry.candidate));

  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(tempBinaryPath), { recursive: true });
  fs.copyFileSync(entry.candidate, tempBinaryPath);
  if (process.platform !== 'win32') {
    fs.chmodSync(tempBinaryPath, 0o755);
  }
  copyBundledRipgrep(entry.binaryPackageRoot, tempRoot);

  try {
    fs.mkdirSync(cacheBase, { recursive: true });
    fs.renameSync(tempRoot, cachedBinaryPackageRoot);
  } catch {
    if (!fs.existsSync(cachedBinaryPath)) {
      return {
        ...entry,
        candidate: tempBinaryPath,
        binaryPackageRoot: tempRoot,
        fallbackBinaryPackageRoot: entry.binaryPackageRoot,
      };
    }

    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  return {
    ...entry,
    candidate: cachedBinaryPath,
    binaryPackageRoot: cachedBinaryPackageRoot,
    fallbackBinaryPackageRoot: entry.binaryPackageRoot,
  };
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
      packageName: platformPackage.packageName,
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
        packageName: platformPackage.packageName,
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
        packageName: packageJson.name,
        skipCache: true,
      }
    : null,
  {
    candidate: path.join(__dirname, binaryName),
    binaryPackageRoot: packageRoot,
    packageName: packageJson.name,
  },
  resolveLocalReleaseCandidate(),
  resolveInstalledPlatformPackageCandidate(),
].filter(Boolean);

for (const entry of binaryCandidates) {
  if (fs.existsSync(entry.candidate)) {
    const runnableEntry = materializeBinaryCandidate(entry);
    run(runnableEntry.candidate, cliArgs, {
      ...process.env,
      RENX_VERSION: process.env.RENX_VERSION || packageJson.version || '0.0.0',
      ...getBundledRipgrepEnv(
        process.env,
        runnableEntry.binaryPackageRoot,
        runnableEntry.fallbackBinaryPackageRoot,
        entry.binaryPackageRoot
      ),
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
      ...getBundledRipgrepEnv(process.env, packageRoot),
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
