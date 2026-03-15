import { describe, expect, it, vi } from 'vitest';

import {
  composeAgentRuntimeHooks,
  createNoopObservation,
} from '../runtime-hooks';

describe('runtime-hooks', () => {
  it('composes lifecycle observations and uses the first available span id', async () => {
    const finishA = vi.fn();
    const finishB = vi.fn();
    const hooks = composeAgentRuntimeHooks([
      {
        onToolExecutionStart: async () => ({
          spanId: 'span_a',
          startedAt: 10,
          finish: finishA,
        }),
      },
      {
        onToolExecutionStart: async () => ({
          startedAt: 20,
          finish: finishB,
        }),
      },
    ]);

    const observation = await hooks.onToolExecutionStart?.({
      callbacks: undefined,
      traceId: 'trace_1',
      executionId: 'exec_1',
      stepIndex: 1,
      toolCallId: 'tool_1',
      toolName: 'bash',
    });

    expect(observation?.spanId).toBe('span_a');
    expect(observation?.startedAt).toBe(10);

    await observation?.finish({
      callbacks: undefined,
      traceId: 'trace_1',
      executionId: 'exec_1',
      stepIndex: 1,
      toolCallId: 'tool_1',
      toolName: 'bash',
      latencyMs: 25,
      cached: false,
      success: true,
      errorCode: undefined,
    });

    expect(finishA).toHaveBeenCalledOnce();
    expect(finishB).toHaveBeenCalledOnce();
  });

  it('provides no-op observations for missing hooks', async () => {
    const hooks = composeAgentRuntimeHooks([{}]);
    const observation =
      (await hooks.onRunStart?.({
        callbacks: undefined,
        traceId: 'trace_2',
        executionId: 'exec_2',
        conversationId: 'conv_2',
        maxSteps: 5,
        timeoutBudgetMs: 1000,
      })) ?? createNoopObservation();

    await expect(
      observation.finish({
        callbacks: undefined,
        traceId: 'trace_2',
        executionId: 'exec_2',
        stepIndex: 1,
        latencyMs: 30,
        outcome: 'done',
        retryCount: 0,
      })
    ).resolves.toBeUndefined();
  });
});
