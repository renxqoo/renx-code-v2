import { describe, expect, it, vi } from 'vitest';

import type { Tool } from '../../../providers';
import type { AgentToolExecutor } from '../tool-executor';
import {
  createLLMStreamRuntimeDeps,
  createRunLoopRuntime,
  createToolRuntime,
  resolveLLMToolsFromExecutor,
} from '../runtime-composition';
import { createNoopObservation } from '../runtime-hooks';
import { ToolSessionState } from '../../tool-v2/context';

describe('runtime-composition', () => {
  it('returns caller-provided tools without consulting the manager', () => {
    const inputTools: Tool[] = [
      {
        type: 'function',
        function: {
          name: 'bash',
          description: 'Run commands',
          parameters: { type: 'object' },
        },
      },
    ];
    const getToolSchemas = vi.fn();

    const result = resolveLLMToolsFromExecutor({ getToolSchemas } as never, inputTools);

    expect(result).toBe(inputTools);
    expect(getToolSchemas).not.toHaveBeenCalled();
  });

  it('normalizes manager schemas into provider tools and defaults empty parameters', () => {
    const result = resolveLLMToolsFromExecutor({
      getToolSchemas: () => [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file',
          },
        },
      ],
    } as never);

    expect(result).toEqual([
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: {},
        },
      },
    ]);
  });

  it('reuses explicit lifecycle hooks for tool runtime instead of rebuilding them', () => {
    const createLifecycleHooks = vi.fn(() => ({
      onRunStart: async () => createNoopObservation(),
    }));
    const providedHooks = {
      onRunStart: async () => createNoopObservation(),
      onRetryScheduled: vi.fn(),
    };

    const runtime = createToolRuntime(
      {
        agentRef: {},
        execution: {
          executor: {} as AgentToolExecutor,
          sessionState: new ToolSessionState(),
          ledger: {} as never,
          maxConcurrentToolCalls: 1,
        },
        callbacks: {
          safe: async () => undefined,
        },
        diagnostics: {
          extractErrorCode: () => undefined,
          logError: () => undefined,
        },
        resilience: {
          throwIfAborted: () => undefined,
        },
        createLifecycleHooks,
        emitEvent: () => undefined,
      },
      providedHooks
    );

    expect(runtime.hooks).toBe(providedHooks);
    expect(createLifecycleHooks).not.toHaveBeenCalled();
  });

  it('builds lifecycle hooks for tool runtime when none are provided', () => {
    const builtHooks = {
      onRunStart: async () => createNoopObservation(),
      onRetryScheduled: vi.fn(),
    };
    const createLifecycleHooks = vi.fn(() => builtHooks);

    const runtime = createToolRuntime({
      agentRef: {},
      execution: {
        executor: {} as AgentToolExecutor,
        sessionState: new ToolSessionState(),
        ledger: {} as never,
        maxConcurrentToolCalls: 1,
      },
      callbacks: {
        safe: async () => undefined,
      },
      diagnostics: {
        extractErrorCode: () => undefined,
        logError: () => undefined,
      },
      resilience: {
        throwIfAborted: () => undefined,
      },
      createLifecycleHooks,
      emitEvent: () => undefined,
    });

    expect(runtime.hooks).toBe(builtHooks);
    expect(createLifecycleHooks).toHaveBeenCalledOnce();
  });

  it('groups run-loop dependencies without mutating their references', () => {
    const hooks = { onRetryScheduled: vi.fn() };
    const safe = vi.fn();
    const safeError = vi.fn();
    const prepareForLlmStep = vi.fn();
    const mergeLLMConfig = vi.fn();
    const createLLMDeps = vi.fn(
      () =>
        ({
          llmProvider: {} as never,
          enableServerSideContinuation: false,
          throwIfAborted: () => undefined,
          logError: () => undefined,
        }) as never
    );
    const createToolRuntimeFn = vi.fn((_sessionState) => ({
      agentRef: {},
      execution: {
        executor: {} as AgentToolExecutor,
        sessionState: new ToolSessionState(),
        ledger: {} as never,
        maxConcurrentToolCalls: 1,
      },
      callbacks: { safe: async () => undefined },
      diagnostics: { extractErrorCode: () => undefined, logError: () => undefined },
      resilience: { throwIfAborted: () => undefined },
      hooks,
      events: { emit: () => undefined },
    }));
    const progress = vi.fn();
    const checkpoint = vi.fn();
    const done = vi.fn();
    const error = vi.fn();
    const maxRetries = vi.fn();
    const createStageAbortScope = vi.fn();
    const throwIfAborted = vi.fn();
    const normalizeTimeoutBudgetError = vi.fn();
    const timeoutBudgetErrorFromSignal = vi.fn();
    const isAbortError = vi.fn();
    const normalizeError = vi.fn();
    const calculateRetryDelay = vi.fn();
    const sleep = vi.fn();
    const extractErrorCode = vi.fn();

    const runtime = createRunLoopRuntime(
      {
        config: { maxRetryCount: 7 },
        callbacks: { safe, safeError },
        messages: { prepareForLlmStep, mergeLLMConfig },
        createLLMStreamRuntimeDeps: createLLMDeps,
        createToolRuntime: createToolRuntimeFn,
        toolSessionState: new ToolSessionState(),
        stream: { progress, checkpoint, done, error, maxRetries },
        resilience: {
          createStageAbortScope,
          throwIfAborted,
          normalizeTimeoutBudgetError,
          timeoutBudgetErrorFromSignal,
          isAbortError,
          normalizeError,
          calculateRetryDelay,
          sleep,
        },
        diagnostics: { extractErrorCode },
        abortedMessage: 'Operation aborted',
      },
      hooks
    );

    expect(runtime.limits).toEqual({
      maxRetryCount: 7,
      abortedMessage: 'Operation aborted',
    });
    expect(runtime.callbacks.safe).toBe(safe);
    expect(runtime.callbacks.safeError).toBe(safeError);
    expect(runtime.messages.prepareForLlmStep).toBe(prepareForLlmStep);
    expect(runtime.stream.progress).toBe(progress);
    expect(runtime.resilience.createStageAbortScope).toBe(createStageAbortScope);
    expect(runtime.diagnostics.extractErrorCode).toBe(extractErrorCode);
    expect(runtime.hooks).toBe(hooks);
  });

  it('keeps llm stream dependencies narrowly scoped', () => {
    const throwIfAborted = vi.fn();
    const logError = vi.fn();
    const llmProvider = { stream: vi.fn() };

    const deps = createLLMStreamRuntimeDeps({
      llmProvider: llmProvider as never,
      enableServerSideContinuation: true,
      throwIfAborted,
      logError,
    });

    expect(deps).toEqual({
      llmProvider,
      enableServerSideContinuation: true,
      throwIfAborted,
      logError,
    });
  });
});
