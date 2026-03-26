import { describe, expect, it } from 'vitest';

import { toBundledBunfsPath } from './bunfs-path';

describe('toBundledBunfsPath', () => {
  it('maps embedded worker files to the Bun root basename on Windows', () => {
    expect(toBundledBunfsPath('node_modules/@opentui/core/parser.worker.js', 'win32')).toBe(
      'B:/~BUN/root/parser.worker.js'
    );
  });

  it('maps embedded worker files to the Bun root basename on unix platforms', () => {
    expect(toBundledBunfsPath('node_modules/@opentui/core/parser.worker.js', 'linux')).toBe(
      '/$bunfs/root/parser.worker.js'
    );
  });

  it('drops nested release-relative prefixes from worker paths', () => {
    expect(
      toBundledBunfsPath('node_modules/@opentui/core/lib/tree-sitter/parser.worker.js', 'win32')
    ).toBe('B:/~BUN/root/parser.worker.js');
  });
});
