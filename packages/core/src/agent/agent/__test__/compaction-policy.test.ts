import { describe, expect, it } from 'vitest';

import type { Message } from '../../types';
import { calculateContextUsage, evaluateCompactionPolicy } from '../compaction-policy';

function createMessage(partial: Partial<Message>): Message {
  return {
    messageId: partial.messageId || crypto.randomUUID(),
    type: partial.type || 'user',
    role: partial.role || 'user',
    content: partial.content || '',
    timestamp: partial.timestamp ?? Date.now(),
    ...partial,
  };
}

describe('compaction-policy', () => {
  it('reports disabled when compaction is turned off', () => {
    const decision = evaluateCompactionPolicy({
      enabled: false,
      triggerRatio: 0.8,
      messages: [createMessage({ content: 'hello' })],
      contextLimitTokens: 100,
    });

    expect(decision).toMatchObject({
      shouldCompact: false,
      reason: 'disabled',
      thresholdTokens: 80,
    });
  });

  it('reports below_threshold when usage has not reached the trigger', () => {
    const messages = [createMessage({ content: 'abcd' })];

    const decision = evaluateCompactionPolicy({
      enabled: true,
      triggerRatio: 0.9,
      messages,
      contextLimitTokens: 20,
    });

    expect(decision.shouldCompact).toBe(false);
    expect(decision.reason).toBe('below_threshold');
    expect(decision.contextTokens).toBeLessThan(decision.thresholdTokens);
  });

  it('reports threshold_reached when usage reaches the trigger', () => {
    const messages = [createMessage({ content: 'abcdefghij' })];

    const decision = evaluateCompactionPolicy({
      enabled: true,
      triggerRatio: 0,
      messages,
      contextLimitTokens: 20,
    });

    expect(decision).toMatchObject({
      shouldCompact: true,
      reason: 'threshold_reached',
      thresholdTokens: 0,
    });
  });

  it('includes tool schema cost in context usage calculation', () => {
    const messages = [createMessage({ content: 'hello' })];
    const withoutTools = calculateContextUsage(messages, undefined, 100);
    const withTools = calculateContextUsage(
      messages,
      [
        {
          type: 'function',
          function: {
            name: 'bash',
            description: 'run command',
            parameters: { type: 'object' },
          },
        },
      ],
      100
    );

    expect(withTools.contextTokens).toBeGreaterThan(withoutTools.contextTokens);
    expect(withTools.contextUsagePercent).toBeGreaterThan(withoutTools.contextUsagePercent);
  });
});
