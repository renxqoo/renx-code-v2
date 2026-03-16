import { describe, expect, it, vi } from 'vitest';

import {
  ensureSupportedRuntime,
  getUnsupportedRuntimeMessage,
  isBunRuntime,
} from './runtime-support';

const setProcess = (nextProcess: NodeJS.Process): (() => void) => {
  const originalProcess = globalThis.process;
  Object.defineProperty(globalThis, 'process', {
    value: nextProcess,
    configurable: true,
    writable: true,
  });

  return () => {
    Object.defineProperty(globalThis, 'process', {
      value: originalProcess,
      configurable: true,
      writable: true,
    });
  };
};

describe('runtime support', () => {
  it('detects bun via process.versions.bun', () => {
    const restoreProcess = setProcess({
      ...process,
      versions: {
        ...process.versions,
        bun: '1.2.0',
      },
    } as NodeJS.Process);

    try {
      expect(isBunRuntime()).toBe(true);
    } finally {
      restoreProcess();
    }
  });

  it('returns false and prints a helpful message when bun is unavailable', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const restoreProcess = setProcess({
      ...process,
      versions: {
        ...process.versions,
        bun: undefined,
      },
    } as unknown as NodeJS.Process);

    try {
      expect(ensureSupportedRuntime()).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(getUnsupportedRuntimeMessage());
    } finally {
      restoreProcess();
      errorSpy.mockRestore();
    }
  });
});
