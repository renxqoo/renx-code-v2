import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RIPGREP_TARGETS: Record<string, string> = {
  'darwin:arm64': 'aarch64-apple-darwin',
  'darwin:x64': 'x86_64-apple-darwin',
  'linux:arm64': 'aarch64-unknown-linux-musl',
  'linux:x64': 'x86_64-unknown-linux-musl',
  'win32:arm64': 'aarch64-pc-windows-msvc',
  'win32:x64': 'x86_64-pc-windows-msvc',
};

export function configureBundledRipgrepEnv(
  env: NodeJS.ProcessEnv = process.env,
  moduleUrl: string = import.meta.url,
  pathExists: (candidate: string) => boolean = fs.existsSync
): void {
  const target = RIPGREP_TARGETS[`${process.platform}:${process.arch}`];
  if (!target) {
    return;
  }

  const packageRoot = path.resolve(path.dirname(fileURLToPath(moduleUrl)), '..', '..');
  const dir = path.join(packageRoot, 'vendor', 'ripgrep', target, 'path');
  const binary = path.join(dir, process.platform === 'win32' ? 'rg.exe' : 'rg');
  if (!pathExists(binary)) {
    return;
  }

  env.RENX_BUNDLED_RG_DIR = dir;
  env.RIPGREP_PATH = binary;
}
