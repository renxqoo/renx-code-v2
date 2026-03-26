import { describe, expect, it, vi } from 'vitest';

import { createTreeSitterDiagnosticResult } from './tree-sitter-diagnostic';

describe('createTreeSitterDiagnosticResult', () => {
  it('returns highlight data for markdown', async () => {
    const client = {
      preloadParser: vi.fn().mockResolvedValue(true),
      highlightOnce: vi.fn().mockResolvedValue({ highlights: [[0, 5, 'markup.heading']] }),
      destroy: vi.fn().mockResolvedValue(undefined),
    };

    const result = await createTreeSitterDiagnosticResult(client, {
      OTUI_TREE_SITTER_WORKER_PATH: 'C:/tmp/parser.worker.wrapper.mjs',
    });

    expect(result.ok).toBe(true);
    expect(result.preload).toBe(true);
    expect(result.env.otuiWorkerPath).toBe('C:/tmp/parser.worker.wrapper.mjs');
    expect(Array.isArray(result.highlight?.highlights)).toBe(true);
    expect(result.highlight?.highlights?.length).toBe(1);
    expect(client.preloadParser).toHaveBeenCalledWith('markdown');
    expect(client.highlightOnce).toHaveBeenCalledWith(
      '# Title\n\n**bold**\n\n```ts\nconst x = 1\n```',
      'markdown'
    );
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it('returns ok false when highlight response omits highlights', async () => {
    const client = {
      preloadParser: vi.fn().mockResolvedValue(true),
      highlightOnce: vi.fn().mockResolvedValue({ warning: 'parser unavailable' }),
      destroy: vi.fn().mockResolvedValue(undefined),
    };

    const result = await createTreeSitterDiagnosticResult(client, {});

    expect(result.ok).toBe(false);
    expect(result.preload).toBe(true);
    expect(result.highlight).toEqual({ warning: 'parser unavailable' });
    expect(result.highlightError).toBeUndefined();
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it('captures preload and highlight failures', async () => {
    const client = {
      preloadParser: vi.fn().mockRejectedValue(new Error('preload failed')),
      highlightOnce: vi.fn().mockRejectedValue(new Error('highlight failed')),
      destroy: vi.fn().mockResolvedValue(undefined),
    };

    const result = await createTreeSitterDiagnosticResult(client, {});

    expect(result.ok).toBe(false);
    expect(result.preload).toBeNull();
    expect(result.preloadError).toBe('preload failed');
    expect(result.highlightError).toBe('highlight failed');
    expect(result.highlight).toBeUndefined();
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });
});
