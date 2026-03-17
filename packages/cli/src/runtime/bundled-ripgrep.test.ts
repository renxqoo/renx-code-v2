import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { configureBundledRipgrepEnv } from './bundled-ripgrep';

const TARGETS: Record<string, string> = {
  'darwin:arm64': 'aarch64-apple-darwin',
  'darwin:x64': 'x86_64-apple-darwin',
  'linux:arm64': 'aarch64-unknown-linux-musl',
  'linux:x64': 'x86_64-unknown-linux-musl',
  'win32:arm64': 'aarch64-pc-windows-msvc',
  'win32:x64': 'x86_64-pc-windows-msvc',
};

describe('configureBundledRipgrepEnv', () => {
  it('sets CLI-scoped ripgrep env vars when the bundled binary exists', () => {
    const target = TARGETS[`${process.platform}:${process.arch}`];
    expect(target).toBeDefined();

    const env: NodeJS.ProcessEnv = {};
    const moduleUrl = pathToFileURL(
      path.join(process.cwd(), 'packages', 'cli', 'dist', 'runtime', 'bundled-ripgrep.js')
    ).href;
    const expectedDir = path.join(
      process.cwd(),
      'packages',
      'cli',
      'vendor',
      'ripgrep',
      target!,
      'path'
    );
    const expectedBinary = path.join(expectedDir, process.platform === 'win32' ? 'rg.exe' : 'rg');

    configureBundledRipgrepEnv(env, moduleUrl, (candidate) => candidate === expectedBinary);

    expect(env.RENX_BUNDLED_RG_DIR).toBe(expectedDir);
    expect(env.RIPGREP_PATH).toBe(expectedBinary);
  });
});
