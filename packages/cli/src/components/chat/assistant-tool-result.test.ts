import { describe, expect, it } from 'vitest';

import { resolveToolResultFallbackText } from './assistant-tool-result';

describe('resolveToolResultFallbackText', () => {
  it('extracts visible content from structured payload when output is absent', () => {
    expect(
      resolveToolResultFallbackText({
        payload: {
          name: 'code-review-expert',
          content: 'You should prioritize bugs, risks, and missing tests.',
        },
      })
    ).toBe('You should prioritize bugs, risks, and missing tests.');
  });

  it('falls back to pretty json when structured payload has no direct content field', () => {
    expect(
      resolveToolResultFallbackText({
        payload: {
          ok: true,
          count: 3,
        },
      })
    ).toContain('"count": 3');
  });
});
