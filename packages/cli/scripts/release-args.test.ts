import { describe, expect, it } from 'bun:test';

import {
  filterReleasePackageDirs,
  resolvePackArgs,
  resolvePrepareArgs,
  resolvePublishArgs,
  resolveReleaseScope,
} from './release-args';

describe('release args', () => {
  it('maps platform-only args into prepare args', () => {
    const args = resolvePrepareArgs(['--platform-only', '--target', 'win32-x64', '--skip-install']);

    expect(args).toEqual(['--platform-only', '--target', 'win32-x64', '--skip-install']);
  });

  it('maps main-only args into prepare args', () => {
    const args = resolvePrepareArgs(['--main-only']);

    expect(args).toEqual(['--main-only']);
  });

  it('preserves legacy --single in prepare args', () => {
    const args = resolvePrepareArgs(['--single', '--dry-run']);

    expect(args).toEqual(['--single']);
  });

  it('preserves legacy --all in prepare args', () => {
    const args = resolvePrepareArgs(['--all', '--skip-install']);

    expect(args).toEqual(['--all', '--skip-install']);
  });

  it('keeps dry-run only in pack args', () => {
    expect(resolvePackArgs(['--platform-only', '--dry-run'])).toEqual(['--dry-run']);
  });

  it('keeps tag and otp only in publish args', () => {
    expect(resolvePublishArgs(['--main-only', '--tag', 'next', '--otp', '123456'])).toEqual([
      '--tag',
      'next',
      '--otp',
      '123456',
    ]);
  });

  it('filters to platform packages for platform-only scope', () => {
    const dirs = [
      'D:/repo/packages/cli/release/platforms/win32-x64',
      'D:/repo/packages/cli/release/platforms/linux-x64',
      'D:/repo/packages/cli/release/main',
    ];

    expect(filterReleasePackageDirs(dirs, 'platform-only')).toEqual([
      'D:/repo/packages/cli/release/platforms/win32-x64',
      'D:/repo/packages/cli/release/platforms/linux-x64',
    ]);
  });

  it('filters to main package for main-only scope', () => {
    const dirs = [
      'D:/repo/packages/cli/release/platforms/win32-x64',
      'D:/repo/packages/cli/release/main',
    ];

    expect(filterReleasePackageDirs(dirs, 'main-only')).toEqual([
      'D:/repo/packages/cli/release/main',
    ]);
  });

  it('defaults to all scope when no exclusive flags are passed', () => {
    expect(resolveReleaseScope(['--target', 'win32-x64'])).toBe('all');
  });

  it('rejects contradictory exclusive flags', () => {
    expect(() => resolveReleaseScope(['--platform-only', '--main-only'])).toThrow(
      'Cannot use --platform-only and --main-only together.'
    );
  });
});
