import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const wrapperSourcePath = path.resolve(process.cwd(), 'bin', 'renx.cjs');

const platformPackageMap: Record<
  string,
  {
    packageName: string;
    binaryName: string;
  }
> = {
  'darwin:arm64': {
    packageName: '@renxqoo/renx-code-darwin-arm64',
    binaryName: 'renx',
  },
  'darwin:x64': {
    packageName: '@renxqoo/renx-code-darwin-x64',
    binaryName: 'renx',
  },
  'linux:arm64': {
    packageName: '@renxqoo/renx-code-linux-arm64',
    binaryName: 'renx',
  },
  'linux:x64': {
    packageName: '@renxqoo/renx-code-linux-x64',
    binaryName: 'renx',
  },
  'win32:x64': {
    packageName: '@renxqoo/renx-code-win32-x64',
    binaryName: 'renx.exe',
  },
};

const tempDirs: string[] = [];

describe('launcher platform package resolution', () => {
  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('runs a platform binary even when npm omitted the platform package manifest', () => {
    const platformPackage = platformPackageMap[`${process.platform}:${process.arch}`];
    if (!platformPackage) {
      return;
    }

    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'renx-launcher-resolution-'));
    tempDirs.push(tempRoot);

    const packageRoot = path.join(tempRoot, 'package');
    const wrapperPath = path.join(packageRoot, 'bin', 'renx.cjs');
    const platformPackageRoot = path.join(
      packageRoot,
      'node_modules',
      ...platformPackage.packageName.split('/')
    );
    const platformBinaryPath = path.join(platformPackageRoot, 'bin', platformPackage.binaryName);

    mkdirSync(path.dirname(wrapperPath), { recursive: true });
    mkdirSync(path.dirname(platformBinaryPath), { recursive: true });
    cpSync(wrapperSourcePath, wrapperPath);
    writeFileSync(
      path.join(packageRoot, 'package.json'),
      `${JSON.stringify({ name: '@renxqoo/renx-code', version: '0.0.66' }, null, 2)}\n`
    );

    cpSync(process.execPath, platformBinaryPath);
    if (process.platform !== 'win32') {
      chmodSync(platformBinaryPath, 0o755);
    }

    const result = spawnSync(process.execPath, [wrapperPath, '-p', 'process.version'], {
      cwd: tempRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        RENX_DISABLE_BINARY_CACHE: '1',
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('Could not find Renx executable');
    expect(result.stdout.trim()).toBe(process.version);
  });
});
