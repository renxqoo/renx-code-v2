import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import type { AssistantReply as AssistantReplyType } from '../../types/chat';
import { AssistantReply } from './assistant-reply';
import { buildUsageItems, getCompletionErrorMessage } from './assistant-reply';

const createReply = (overrides: Partial<AssistantReplyType> = {}): AssistantReplyType => ({
  agentLabel: '',
  modelLabel: 'glm-5',
  durationSeconds: 0.8,
  segments: [],
  status: 'done',
  ...overrides,
});

describe('assistant-reply helpers', () => {
  it('renders completion errors inside a card with a red left rail', () => {
    const reply = createReply({
      status: 'error',
      completionReason: 'error',
      completionMessage: 'Server returned 500: upstream provider timeout',
    });

    const { container } = render(<AssistantReply reply={reply} />);
    const rootBox = container.querySelector('box');
    const errorCardRow = rootBox?.children[0] as HTMLElement | undefined;
    const railBox = errorCardRow?.firstElementChild as HTMLElement | null;

    expect(railBox).toBeTruthy();
    expect(railBox?.getAttribute('bordercolor')).toBe('#dc2626');
  });

  it('extracts completion error messages for error replies', () => {
    const reply = createReply({
      status: 'error',
      completionReason: 'error',
      completionMessage: 'Server returned 500: upstream provider timeout',
    });

    expect(getCompletionErrorMessage(reply)).toBe('Server returned 500: upstream provider timeout');
  });

  it('ignores completion messages for non-error replies', () => {
    const reply = createReply({
      status: 'done',
      completionReason: 'stop',
      completionMessage: 'Should not be shown',
    });

    expect(getCompletionErrorMessage(reply)).toBeUndefined();
  });

  it('keeps usage items compact and directional', () => {
    const reply = createReply({
      usagePromptTokens: 1250,
      usageCompletionTokens: 2400,
    });

    expect(buildUsageItems(reply)).toEqual([
      { icon: '↑', value: '1.25k' },
      { icon: '↓', value: '2.40k' },
    ]);
  });
});
