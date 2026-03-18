const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function resolveBinaryName(platform = process.platform) {
  return platform === 'win32' ? 'renx.exe' : 'renx';
}

function readPackageVersion(packageRoot, readFileSync = fs.readFileSync) {
  try {
    const packageJson = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    return packageJson.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function getBundledRipgrepEnv({
  packageRoot,
  baseEnv = process.env,
  platform = process.platform,
  arch = process.arch,
  existsSync = fs.existsSync,
}) {
  const targetByPlatform = {
    'darwin:arm64': 'aarch64-apple-darwin',
    'darwin:x64': 'x86_64-apple-darwin',
    'linux:arm64': 'aarch64-unknown-linux-musl',
    'linux:x64': 'x86_64-unknown-linux-musl',
    'win32:arm64': 'aarch64-pc-windows-msvc',
    'win32:x64': 'x86_64-pc-windows-msvc',
  };

  const target = targetByPlatform[`${platform}:${arch}`];
  if (!target) {
    return {};
  }

  const dir = path.join(packageRoot, 'vendor', 'ripgrep', target, 'path');
  const binary = path.join(dir, platform === 'win32' ? 'rg.exe' : 'rg');
  if (!existsSync(binary)) {
    return {};
  }

  return {
    RENX_BUNDLED_RG_DIR: baseEnv.RENX_BUNDLED_RG_DIR || dir,
    RIPGREP_PATH: baseEnv.RIPGREP_PATH || binary,
  };
}

function resolveBootstrapTarget({
  packageRoot,
  env = process.env,
  platform = process.platform,
  existsSync = fs.existsSync,
}) {
  const binaryName = resolveBinaryName(platform);
  const binaryCandidates = [
    env.RENX_BIN_PATH,
    path.join(packageRoot, 'bin', binaryName),
    path.join(packageRoot, 'release', 'publish', 'bin', binaryName),
  ].filter(Boolean);

  for (const candidate of binaryCandidates) {
    if (existsSync(candidate)) {
      return {
        kind: 'binary',
        target: candidate,
      };
    }
  }

  const distEntry = path.join(packageRoot, 'dist', 'index.js');
  if (existsSync(distEntry)) {
    return {
      kind: 'node-dist',
      target: distEntry,
    };
  }

  return {
    kind: 'missing',
    message: `Could not find Renx executable: expected ${binaryName} or dist/index.js under ${packageRoot}.`,
    hint: 'Build dist with `pnpm run build`, provide a packaged binary, or set `RENX_BIN_PATH`.',
  };
}

function runTarget({
  target,
  args,
  env,
  processCwd = () => process.cwd(),
  spawnSync = childProcess.spawnSync,
  printStderr = (message) => console.error(message),
  exit = (code) => process.exit(code),
}) {
  const result = spawnSync(target, args, {
    cwd: processCwd(),
    stdio: 'inherit',
    env,
  });

  if (result.error) {
    printStderr(result.error.message);
    exit(1);
    return;
  }

  exit(typeof result.status === 'number' ? result.status : 0);
}

function runCliBootstrap({
  packageRoot = path.resolve(__dirname, '..'),
  argv = process.argv.slice(2),
  env = process.env,
  execPath = process.execPath,
  platform = process.platform,
  arch = process.arch,
  existsSync = fs.existsSync,
  readFileSync = fs.readFileSync,
  processCwd = () => process.cwd(),
  spawnSync = childProcess.spawnSync,
  printStdout = (message) => process.stdout.write(message),
  printStderr = (message) => console.error(message),
  exit = (code) => process.exit(code),
}) {
  const packageVersion = readPackageVersion(packageRoot, readFileSync);

  if (argv.includes('-v') || argv.includes('--version')) {
    printStdout(`${packageVersion || '0.0.0'}\n`);
    exit(0);
    return;
  }

  const plan = resolveBootstrapTarget({
    packageRoot,
    env,
    platform,
    existsSync,
  });

  if (plan.kind === 'missing') {
    printStderr(plan.message);
    printStderr(plan.hint);
    exit(1);
    return;
  }

  const launchEnv = {
    ...env,
    RENX_VERSION: env.RENX_VERSION || packageVersion || '0.0.0',
    ...getBundledRipgrepEnv({
      packageRoot,
      baseEnv: env,
      platform,
      arch,
      existsSync,
    }),
  };

  if (plan.kind === 'binary') {
    runTarget({
      target: plan.target,
      args: argv,
      env: launchEnv,
      processCwd,
      spawnSync,
      printStderr,
      exit,
    });
    return;
  }

  runTarget({
    target: execPath,
    args: [plan.target, ...argv],
    env: {
      ...launchEnv,
      AGENT_WORKDIR: env.AGENT_WORKDIR || processCwd(),
    },
    processCwd,
    spawnSync,
    printStderr,
    exit,
  });
}

module.exports = {
  getBundledRipgrepEnv,
  readPackageVersion,
  resolveBinaryName,
  resolveBootstrapTarget,
  runCliBootstrap,
};
