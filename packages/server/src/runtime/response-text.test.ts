import { describe, expect, it } from 'vitest';
import type { Message } from '@renx-code/core';

import { extractAssistantResponseText } from './response-text';

describe('extractAssistantResponseText', () => {
  it('returns the latest assistant text content', () => {
    const messages: Message[] = [
      {
        messageId: 'm1',
        type: 'user',
        role: 'user',
        content: 'hi',
        timestamp: 1,
      },
      {
        messageId: 'm2',
        type: 'assistant-text',
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
        timestamp: 2,
      },
      {
        messageId: 'm3',
        type: 'assistant-text',
        role: 'assistant',
        content: 'world',
        timestamp: 3,
      },
    ];

    expect(extractAssistantResponseText(messages)).toBe('world');
  });

  it('returns an empty string when assistant output is absent', () => {
    expect(
      extractAssistantResponseText([
        {
          messageId: 'm1',
          type: 'user',
          role: 'user',
          content: 'hi',
          timestamp: 1,
        },
      ])
    ).toBe('');
  });
});
