import { describe, expect, it, vi } from 'vitest';

import { createObservabilityLifecycleHooks } from '../observability-hooks';

describe('observability-hooks', () => {
  it('emits run metrics and closes the run span on finish', async () => {
    const startSpan = vi.fn(async () => ({
      traceId: 'trace_1',
      spanId: 'span_run',
      parentSpanId: undefined,
      name: 'agent.run',
      startedAt: 100,
    }));
    const endSpan = vi.fn(async () => undefined);
    const emitMetric = vi.fn(async () => undefined);
    const logInfo = vi.fn();

    const hooks = createObservabilityLifecycleHooks({
      startSpan,
      endSpan,
      emitMetric,
      logInfo,
      logWarn: vi.fn(),
      logError: vi.fn(),
    });

    const observation = await hooks.onRunStart?.({
      callbacks: undefined,
      traceId: 'trace_1',
      executionId: 'exec_1',
      conversationId: 'conv_1',
      maxSteps: 8,
      timeoutBudgetMs: 1200,
    });

    await observation?.finish({
      callbacks: undefined,
      traceId: 'trace_1',
      executionId: 'exec_1',
      stepIndex: 3,
      latencyMs: 250,
      outcome: 'done',
      retryCount: 2,
      errorCode: undefined,
    });

    expect(startSpan).toHaveBeenCalledWith(undefined, 'trace_1', 'agent.run', undefined, {
      executionId: 'exec_1',
      conversationId: 'conv_1',
      maxSteps: 8,
      timeoutBudgetMs: 1200,
    });
    expect(emitMetric).toHaveBeenNthCalledWith(1, undefined, {
      name: 'agent.run.duration_ms',
      value: 250,
      unit: 'ms',
      timestamp: expect.any(Number),
      tags: {
        executionId: 'exec_1',
        outcome: 'done',
      },
    });
    expect(emitMetric).toHaveBeenNthCalledWith(2, undefined, {
      name: 'agent.retry.count',
      value: 2,
      unit: 'count',
      timestamp: expect.any(Number),
      tags: {
        executionId: 'exec_1',
      },
    });
    expect(endSpan).toHaveBeenCalledWith(
      undefined,
      {
        traceId: 'trace_1',
        spanId: 'span_run',
        parentSpanId: undefined,
        name: 'agent.run',
        startedAt: 100,
      },
      {
        executionId: 'exec_1',
        stepIndex: 3,
        latencyMs: 250,
        outcome: 'done',
        errorCode: undefined,
        retryCount: 2,
      }
    );
    expect(logInfo).toHaveBeenCalledTimes(2);
  });

  it('records tool execution metrics with cached and success tags', async () => {
    const endSpan = vi.fn(async () => undefined);
    const emitMetric = vi.fn(async () => undefined);
    const logInfo = vi.fn();
    const hooks = createObservabilityLifecycleHooks({
      startSpan: vi.fn(async (_callbacks, traceId, name, parentSpanId) => ({
        traceId,
        spanId: 'span_tool_exec',
        parentSpanId,
        name,
        startedAt: 50,
      })),
      endSpan,
      emitMetric,
      logInfo,
      logWarn: vi.fn(),
      logError: vi.fn(),
    });

    const observation = await hooks.onToolExecutionStart?.({
      callbacks: undefined,
      traceId: 'trace_tool',
      executionId: 'exec_tool',
      stepIndex: 5,
      toolCallId: 'tool_5',
      toolName: 'write_file',
      parentSpanId: 'span_parent',
    });

    await observation?.finish({
      callbacks: undefined,
      traceId: 'trace_tool',
      executionId: 'exec_tool',
      stepIndex: 5,
      toolCallId: 'tool_5',
      toolName: 'write_file',
      latencyMs: 88,
      cached: true,
      success: false,
      errorCode: 'TOOL_FAILED',
    });

    expect(emitMetric).toHaveBeenCalledWith(undefined, {
      name: 'agent.tool.duration_ms',
      value: 88,
      unit: 'ms',
      timestamp: expect.any(Number),
      tags: {
        executionId: 'exec_tool',
        stepIndex: '5',
        toolCallId: 'tool_5',
        cached: 'true',
        success: 'false',
      },
    });
    expect(endSpan).toHaveBeenCalledWith(
      undefined,
      {
        traceId: 'trace_tool',
        spanId: 'span_tool_exec',
        parentSpanId: 'span_parent',
        name: 'agent.tool.execute',
        startedAt: 50,
      },
      {
        executionId: 'exec_tool',
        stepIndex: 5,
        toolCallId: 'tool_5',
        toolName: 'write_file',
        latencyMs: 88,
        cached: true,
        errorCode: 'TOOL_FAILED',
      }
    );
    expect(logInfo).toHaveBeenCalledWith('[Agent] tool.execute', {
      executionId: 'exec_tool',
      traceId: 'trace_tool',
      spanId: 'span_tool_exec',
      parentSpanId: 'span_parent',
      stepIndex: 5,
      toolCallId: 'tool_5',
      toolName: 'write_file',
      latencyMs: 88,
      cached: true,
      errorCode: 'TOOL_FAILED',
    });
  });

  it('logs run errors and retry scheduling with structured context', async () => {
    const logWarn = vi.fn();
    const logError = vi.fn();
    const hooks = createObservabilityLifecycleHooks({
      startSpan: vi.fn(async () => ({
        traceId: 'trace_1',
        spanId: 'span_1',
        parentSpanId: undefined,
        name: 'agent.run',
        startedAt: 1,
      })),
      endSpan: vi.fn(async () => undefined),
      emitMetric: vi.fn(async () => undefined),
      logInfo: vi.fn(),
      logWarn,
      logError,
    });

    const error = new Error('boom');
    await hooks.onRunError?.({
      executionId: 'exec_error',
      traceId: 'trace_error',
      stepIndex: 4,
      retryCount: 1,
      errorCode: 'AGENT_FAILED',
      category: 'runtime',
      error,
    });
    await hooks.onRetryScheduled?.({
      executionId: 'exec_error',
      traceId: 'trace_error',
      stepIndex: 4,
      retryCount: 1,
      errorCode: 'AGENT_FAILED',
    });

    expect(logError).toHaveBeenCalledWith('[Agent] run.error', error, {
      executionId: 'exec_error',
      traceId: 'trace_error',
      stepIndex: 4,
      retryCount: 1,
      errorCode: 'AGENT_FAILED',
      category: 'runtime',
    });
    expect(logWarn).toHaveBeenCalledWith('[Agent] retry.scheduled', {
      executionId: 'exec_error',
      traceId: 'trace_error',
      stepIndex: 4,
      retryCount: 1,
      errorCode: 'AGENT_FAILED',
    });
  });
});
