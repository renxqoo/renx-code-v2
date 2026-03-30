import { describe, it, expect } from 'vitest';
import { resolveStateDir, resolveTempDir } from './state-dir.js';

describe('resolveStateDir', () => {
  it('should return a valid path', () => {
    const dir = resolveStateDir();
    expect(dir).toBeTruthy();
    expect(typeof dir).toBe('string');
  });

  it('should use RENX_STATE_DIR env when set', () => {
    const original = process.env.RENX_STATE_DIR;
    process.env.RENX_STATE_DIR = '/tmp/test-renx';
    expect(resolveStateDir()).toBe('/tmp/test-renx');
    process.env.RENX_STATE_DIR = original;
  });
});

describe('resolveTempDir', () => {
  it('should return a path ending with tmp', () => {
    const dir = resolveTempDir();
    expect(dir).toContain('tmp');
  });
});
