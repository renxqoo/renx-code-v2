import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const RIPGREP_TARGETS: Record<string, string> = {
  'darwin:arm64': 'aarch64-apple-darwin',
  'darwin:x64': 'x86_64-apple-darwin',
  'linux:arm64': 'aarch64-unknown-linux-musl',
  'linux:x64': 'x86_64-unknown-linux-musl',
  'win32:arm64': 'aarch64-pc-windows-msvc',
  'win32:x64': 'x86_64-pc-windows-msvc',
};

export interface ResolveBundledRipgrepPathEntriesOptions {
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly moduleUrl?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly pathExists?: (candidate: string) => boolean;
}

export function resolveBundledRipgrepTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): string | undefined {
  return RIPGREP_TARGETS[`${platform}:${arch}`];
}

export function resolveBundledRipgrepPathEntries(
  options: ResolveBundledRipgrepPathEntriesOptions = {}
): string[] {
  const platform = options.platform || process.platform;
  const target = resolveBundledRipgrepTarget(platform, options.arch);
  if (!target) {
    return [];
  }

  const moduleUrl = options.moduleUrl || import.meta.url;
  const env = options.env || process.env;
  const pathExists = options.pathExists || fs.existsSync;
  const envEntries = resolveBundledRipgrepEnvEntries(env, platform, pathExists);
  if (envEntries.length > 0) {
    return envEntries;
  }
  const runtimeDir = path.dirname(fileURLToPath(moduleUrl));
  const packageRoot = path.resolve(runtimeDir, '..', '..', '..', '..');
  const binDir = path.join(packageRoot, 'vendor', 'ripgrep', target, 'path');
  const binaryName = platform === 'win32' ? 'rg.exe' : 'rg';
  const binaryPath = path.join(binDir, binaryName);

  return pathExists(binaryPath) ? [binDir] : [];
}

function resolveBundledRipgrepEnvEntries(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  pathExists: (candidate: string) => boolean
): string[] {
  const binaryName = platform === 'win32' ? 'rg.exe' : 'rg';
  const candidateDirs = new Set<string>();

  const bundledDir = env.RENX_BUNDLED_RG_DIR?.trim();
  if (bundledDir) {
    candidateDirs.add(bundledDir);
  }

  const ripgrepPath = env.RIPGREP_PATH?.trim();
  if (ripgrepPath) {
    candidateDirs.add(path.dirname(ripgrepPath));
  }

  for (const candidateDir of candidateDirs) {
    if (pathExists(path.join(candidateDir, binaryName))) {
      return [candidateDir];
    }
  }

  return [];
}
