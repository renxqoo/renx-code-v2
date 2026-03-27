import { describe, expect, it } from 'vitest';

import { resolveConversationId } from './session-key';

describe('resolveConversationId', () => {
  it('returns explicit conversationId when provided', () => {
    expect(resolveConversationId({ conversationId: 'conv_explicit', user: 'alice' })).toBe(
      'conv_explicit'
    );
  });

  it('derives a stable session id from user', () => {
    const first = resolveConversationId({ user: 'alice' });
    const second = resolveConversationId({ user: 'alice' });
    const third = resolveConversationId({ user: 'bob' });

    expect(first).toBe(second);
    expect(first).toMatch(/^conv_/);
    expect(third).not.toBe(first);
  });

  it('creates a new conversation id when user is absent', () => {
    const first = resolveConversationId({});
    const second = resolveConversationId({});

    expect(first).toMatch(/^conv_/);
    expect(second).toMatch(/^conv_/);
    expect(first).not.toBe(second);
  });
});
