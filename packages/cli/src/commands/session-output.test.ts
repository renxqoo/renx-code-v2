import { describe, expect, it } from 'vitest';

import { renderSessionDetail, renderSessionList } from './session-output';

describe('session-output', () => {
  it('renders empty list message', () => {
    expect(renderSessionList([])).toBe('No sessions found.');
  });

  it('renders session list entries', () => {
    const output = renderSessionList([
      {
        conversationId: 'session-01',
        createdAt: 1710000000000,
        updatedAt: 1710000001000,
        runCount: 2,
        lastRunStatus: 'COMPLETED',
        lastUserMessageText: 'hello',
        lastAssistantMessageText: 'world',
      },
    ]);

    expect(output).toContain('session-01');
    expect(output).toContain('runs=2');
    expect(output).toContain('user=hello');
  });

  it('renders session detail', () => {
    const output = renderSessionDetail({
      conversationId: 'session-02',
      createdAt: 1710000000000,
      updatedAt: 1710000001000,
      runCount: 1,
      lastRunStatus: 'RUNNING',
      lastUserMessageText: 'foo',
      lastAssistantMessageText: 'bar',
    });

    expect(output).toContain('id: session-02');
    expect(output).toContain('runCount: 1');
    expect(output).toContain('lastAssistantMessage: bar');
  });

  it('renders missing session message', () => {
    expect(renderSessionDetail(null)).toBe('Session not found.');
  });
});
