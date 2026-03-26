import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveBundledOpenTuiWorkerEnv } from './bundled-opentui-worker';

const tempDirs: string[] = [];

describe('resolveBundledOpenTuiWorkerEnv', () => {
  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns an external worker wrapper path when the bundled worker exists', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'renx-otui-worker-'));
    tempDirs.push(tempRoot);

    const binaryPackageRoot = path.join(tempRoot, 'pkg');
    const workerDir = path.join(binaryPackageRoot, 'bin', 'otui-worker-bundle');
    const wrapperPath = path.join(workerDir, 'parser.worker.wrapper.mjs');

    mkdirSync(workerDir, { recursive: true });
    writeFileSync(wrapperPath, 'export {};\n');

    expect(resolveBundledOpenTuiWorkerEnv({}, binaryPackageRoot)).toEqual({
      OTUI_TREE_SITTER_WORKER_PATH: wrapperPath,
    });
  });

  it('preserves an explicit worker path override', () => {
    const env = { OTUI_TREE_SITTER_WORKER_PATH: 'custom-worker.js' };
    expect(resolveBundledOpenTuiWorkerEnv(env, 'C:/pkg')).toEqual({
      OTUI_TREE_SITTER_WORKER_PATH: 'custom-worker.js',
    });
  });

  it('returns an empty env patch when no external worker bundle is present', () => {
    expect(resolveBundledOpenTuiWorkerEnv({}, 'C:/missing')).toEqual({});
  });
});
