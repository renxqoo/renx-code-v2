import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentCallbacks,
  AgentMetric,
  Message,
  StreamEvent,
  ToolPolicyCheckInfo,
} from '../../types';
import type { ToolConcurrencyPolicy } from '../../tool/types';
import type { ToolCall } from '../../../providers';
import { InMemoryToolExecutionLedger, NoopToolExecutionLedger } from '../tool-execution-ledger';
import type { AgentToolExecutor } from '../tool-executor';
import {
  executeTool,
  processToolCalls,
  resolveToolConcurrencyPolicy,
  type ToolRuntime,
} from '../tool-runtime';
import { throwIfAborted } from '../abort-runtime';
import { createNoopObservation } from '../runtime-hooks';
import { ToolSessionState } from '../../tool-v2/context';

type MetricRecord = AgentMetric[];

function createToolManager() {
  return {
    execute: vi.fn(),
    registerTool: vi.fn(),
    registerTools: vi.fn(),
    getTools: vi.fn(() => []),
    getToolSchemas: vi.fn(() => []),
    getConcurrencyPolicy: vi.fn(() => ({ mode: 'exclusive' as const })),
  } as unknown as AgentToolExecutor;
}

function createToolRuntime(options?: {
  manager?: AgentToolExecutor;
  emitter?: EventEmitter;
  metrics?: MetricRecord;
  maxConcurrentToolCalls?: number;
  toolExecutionLedger?: ToolRuntime['execution']['ledger'];
  toolConcurrencyPolicyResolver?: (toolCall: ToolCall) => ToolConcurrencyPolicy;
}) {
  const manager = options?.manager ?? createToolManager();
  const emitter = options?.emitter ?? new EventEmitter();
  const metrics = options?.metrics ?? [];

  const runtime: ToolRuntime = {
    agentRef: {},
    execution: {
      executor: manager,
      sessionState: new ToolSessionState(),
      ledger: options?.toolExecutionLedger ?? new NoopToolExecutionLedger(),
      maxConcurrentToolCalls: options?.maxConcurrentToolCalls ?? 1,
      resolveConcurrencyPolicy: options?.toolConcurrencyPolicyResolver,
    },
    callbacks: {
      safe: async (callback, arg) => {
        await callback?.(arg);
      },
    },
    diagnostics: {
      logError: () => undefined,
      extractErrorCode: (error) =>
        typeof (error as { errorCode?: unknown })?.errorCode === 'string'
          ? ((error as { errorCode?: string }).errorCode as string)
          : undefined,
    },
    resilience: {
      throwIfAborted: (signal?: AbortSignal) => {
        throwIfAborted(signal, 'Operation aborted');
      },
    },
    hooks: {
      onToolExecutionStart: async () => {
        const startedAt = Date.now();
        return {
          spanId: 'span_agent.tool.execute',
          startedAt,
          async finish(context) {
            metrics.push({
              name: 'agent.tool.duration_ms',
              value: context.latencyMs,
              unit: 'ms',
              timestamp: Date.now(),
              tags: {
                executionId: context.executionId || '',
                stepIndex: String(context.stepIndex),
                toolCallId: context.toolCallId,
                cached: context.cached ? 'true' : 'false',
                success: context.success ? 'true' : 'false',
              },
            });
          },
        };
      },
      onRunStart: async () => createNoopObservation(),
      onLLMStageStart: async () => createNoopObservation(),
      onToolStageStart: async () => createNoopObservation(),
    },
    events: {
      emit: (eventName, payload) => {
        emitter.emit(eventName, payload);
      },
    },
  };

  return { runtime, manager, emitter, metrics };
}

async function collectEvents(generator: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

function createCallbacks(
  overrides: Partial<AgentCallbacks> = {}
): Pick<AgentCallbacks, 'onMessage' | 'onCheckpoint'> & Partial<AgentCallbacks> {
  return {
    onMessage: vi.fn(),
    onCheckpoint: vi.fn(),
    ...overrides,
  };
}

const emitProgress = (
  executionId: string | undefined,
  stepIndex: number,
  currentAction: 'llm' | 'tool',
  messageCount: number
): Generator<StreamEvent> =>
  (function* () {
    yield {
      type: 'progress',
      data: {
        executionId,
        stepIndex,
        currentAction,
        messageCount,
      },
    };
  })();

describe('tool-runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('executeTool emits a fallback unknown error message when tool fails without output', async () => {
    const { runtime, manager, emitter } = createToolRuntime();
    const onMessage = vi.fn();
    const toolChunkSpy = vi.fn();

    manager.execute = vi.fn().mockImplementation(async (_toolCall, options) => {
      await options.onStreamEvent?.({ type: 'stdout', message: 'chunk-1' });
      const decision = await options.onApproval?.({
        toolName: 'bash',
        callId: 'call_2',
        reason: 'run bash',
      });
      expect(decision).toEqual({ approved: true, scope: 'once', reason: 'approved' });
      return { success: false };
    });

    emitter.on('tool_chunk', toolChunkSpy);
    emitter.on(
      'tool_confirm',
      (info: { resolve: (decision: { approved: boolean; message?: string }) => void }) => {
        info.resolve({ approved: true, message: 'approved' });
      }
    );

    const events = await collectEvents(
      executeTool(runtime, {
        toolCall: {
          id: 'call_2',
          type: 'function',
          index: 0,
          function: { name: 'bash', arguments: '{}' },
        },
        stepIndex: 2,
        callbacks: createCallbacks({ onMessage }),
      })
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'tool_result',
      data: { role: 'tool', content: 'Command failed.', tool_call_id: 'call_2' },
    });
    expect(onMessage).toHaveBeenCalledOnce();
    expect(toolChunkSpy).toHaveBeenCalledOnce();
  });

  it('executeTool forwards onToolPolicy decisions to the tool executor', async () => {
    const { runtime, manager } = createToolRuntime();
    const onToolPolicy = vi.fn().mockResolvedValue({
      allowed: false,
      code: 'DANGEROUS_COMMAND',
      message: 'rm blocked',
    });

    manager.execute = vi.fn().mockImplementation(async (_toolCall, options) => {
      const policyDecision = await options.onPolicyCheck?.({
        toolCallId: 'call_policy',
        toolName: 'bash',
        arguments: '{"command":"rm -rf /"}',
        parsedArguments: { command: 'rm -rf /' },
      } as ToolPolicyCheckInfo);
      expect(policyDecision).toEqual({
        allowed: false,
        code: 'DANGEROUS_COMMAND',
        message: 'rm blocked',
      });
      return {
        success: false,
        error: {
          name: 'ToolPolicyDeniedError',
          message: 'Tool bash blocked by policy [DANGEROUS_COMMAND]: rm blocked',
        },
      };
    });

    const events = await collectEvents(
      executeTool(runtime, {
        toolCall: {
          id: 'call_policy',
          type: 'function',
          index: 0,
          function: { name: 'bash', arguments: '{"command":"rm -rf /"}' },
        },
        stepIndex: 1,
        callbacks: createCallbacks({ onToolPolicy }) as AgentCallbacks,
      })
    );

    expect(onToolPolicy).toHaveBeenCalledWith({
      toolCallId: 'call_policy',
      toolName: 'bash',
      arguments: '{"command":"rm -rf /"}',
      parsedArguments: { command: 'rm -rf /' },
    });
    expect(events[0]).toMatchObject({
      type: 'tool_result',
      data: {
        content: 'Command failed: Tool bash blocked by policy [DANGEROUS_COMMAND]: rm blocked',
      },
    });
  });

  it('executeTool resolves confirmations through tool_confirm events', async () => {
    const { runtime, manager, emitter } = createToolRuntime();
    const onMessage = vi.fn();
    const toolChunkSpy = vi.fn();

    manager.execute = vi.fn().mockImplementation(async (_toolCall, options) => {
      await options.onStreamEvent?.({ type: 'stdout', message: 'chunk-2' });
      const decision = await options.onApproval?.({
        toolName: 'bash',
        callId: 'call_3',
        reason: 'run bash',
      });
      return decision?.approved ? { success: true, output: 'approved-output' } : { success: false };
    });

    emitter.on('tool_chunk', toolChunkSpy);
    emitter.on(
      'tool_confirm',
      (info: { resolve: (decision: { approved: boolean; message?: string }) => void }) => {
        info.resolve({ approved: true, message: 'approved' });
      }
    );

    const events = await collectEvents(
      executeTool(runtime, {
        toolCall: {
          id: 'call_3',
          type: 'function',
          index: 0,
          function: { name: 'bash', arguments: '{}' },
        },
        stepIndex: 3,
        callbacks: createCallbacks({ onMessage }),
      })
    );

    expect(events[0]).toMatchObject({
      type: 'tool_result',
      data: { content: 'approved-output', tool_call_id: 'call_3' },
    });
    expect(onMessage).toHaveBeenCalledOnce();
    expect(toolChunkSpy).toHaveBeenCalledOnce();
  });

  it('executeTool resolves permission requests through tool_permission events', async () => {
    const { runtime, manager, emitter } = createToolRuntime();

    manager.execute = vi.fn().mockImplementation(async (_toolCall, options) => {
      const grant = await options.onPermissionRequest?.({
        toolName: 'read_file',
        callId: 'call_perm_1',
        requestedScope: 'turn',
        permissions: {
          fileSystem: {
            read: ['/tmp/project'],
          },
        },
        reason: 'Need access to /tmp/project',
      });
      return grant?.granted
        ? { success: true, output: JSON.stringify(grant.granted) }
        : { success: false, output: 'permission denied' };
    });

    emitter.on(
      'tool_permission',
      (info: {
        resolve: (grant: { granted: Record<string, unknown>; scope: 'turn' | 'session' }) => void;
      }) => {
        info.resolve({
          granted: {
            fileSystem: {
              read: ['/tmp/project'],
            },
          },
          scope: 'turn',
        });
      }
    );

    const events = await collectEvents(
      executeTool(runtime, {
        toolCall: {
          id: 'call_perm_1',
          type: 'function',
          index: 0,
          function: { name: 'read_file', arguments: '{"path":"/tmp/project"}' },
        },
        stepIndex: 4,
        callbacks: createCallbacks(),
      })
    );

    expect(events[0]).toMatchObject({
      type: 'tool_result',
      data: {
        content: '{"fileSystem":{"read":["/tmp/project"]}}',
        tool_call_id: 'call_perm_1',
      },
    });
  });

  it('executeTool returns an aborted confirmation result when the signal aborts first', async () => {
    const { runtime, manager } = createToolRuntime();
    const abortController = new AbortController();

    manager.execute = vi.fn().mockImplementation(async (_toolCall, options) => {
      abortController.abort();
      const decision = await options.onApproval?.({
        toolName: 'bash',
        callId: 'call_abort_confirm',
        reason: 'run bash',
      });
      expect(decision).toEqual({ approved: false, scope: 'once', reason: 'Operation aborted' });
      return {
        success: false,
        error: { message: decision?.reason || 'Operation aborted' },
      };
    });

    const events = await collectEvents(
      executeTool(runtime, {
        toolCall: {
          id: 'call_abort_confirm',
          type: 'function',
          index: 0,
          function: { name: 'bash', arguments: '{}' },
        },
        stepIndex: 1,
        callbacks: createCallbacks(),
        abortSignal: abortController.signal,
      })
    );

    expect(events[0]).toMatchObject({
      type: 'tool_result',
      data: { content: 'Command failed: Operation aborted', tool_call_id: 'call_abort_confirm' },
    });
  });

  it('executeTool auto-finalizes write_file buffered responses before returning the final tool result', async () => {
    const { runtime, manager } = createToolRuntime();
    manager.execute = vi
      .fn()
      .mockImplementationOnce(async (toolCall: ToolCall) => {
        expect(toolCall.id).toBe('call_write_file');
        return {
          success: false,
          output: JSON.stringify({
            ok: false,
            code: 'WRITE_FILE_PARTIAL_BUFFERED',
            nextAction: 'finalize',
            buffer: {
              bufferId: 'buffer_1',
              path: 'D:\\tmp\\out.txt',
            },
            nextArgs: {
              mode: 'finalize',
              bufferId: 'buffer_1',
              path: 'D:\\tmp\\out.txt',
            },
          }),
        };
      })
      .mockImplementationOnce(async (toolCall: ToolCall) => {
        expect(toolCall.id).toBe('call_write_file__finalize');
        expect(JSON.parse(toolCall.function.arguments)).toEqual({
          mode: 'finalize',
          bufferId: 'buffer_1',
          path: 'D:\\tmp\\out.txt',
        });
        return {
          success: true,
          output: 'file committed',
        };
      });

    const events = await collectEvents(
      executeTool(runtime, {
        toolCall: {
          id: 'call_write_file',
          type: 'function',
          index: 0,
          function: {
            name: 'write_file',
            arguments: '{"path":"D:\\\\tmp\\\\out.txt","content":"abc"}',
          },
        },
        stepIndex: 1,
        callbacks: createCallbacks(),
      })
    );

    expect(events[0]).toMatchObject({
      type: 'tool_result',
      data: {
        content: 'file committed',
        tool_call_id: 'call_write_file',
      },
    });
    expect(manager.execute).toHaveBeenCalledTimes(2);
  });

  it('processToolCalls executes a single tool and appends the result message', async () => {
    const { runtime, manager } = createToolRuntime();
    manager.execute = vi.fn().mockResolvedValue({ success: true, output: 'tool-ok' });
    const messages: Message[] = [
      {
        messageId: 'm0',
        type: 'assistant-text',
        role: 'assistant',
        content: 'before',
        timestamp: 1,
      },
    ];

    const events = await collectEvents(
      processToolCalls(runtime, {
        toolCalls: [
          {
            id: 'tool_1',
            type: 'function',
            index: 0,
            function: { name: 'bash', arguments: '{"command":"echo ok"}' },
          },
        ],
        messages,
        stepIndex: 1,
        callbacks: createCallbacks(),
        emitProgress,
      })
    );

    expect(events.map((event) => event.type)).toEqual(['progress', 'tool_result']);
    expect(messages.at(-1)).toMatchObject({
      role: 'tool',
      content: 'tool-ok',
      tool_call_id: 'tool_1',
    });
  });

  it('reuses cached tool results across reruns with the same executionId and toolCallId', async () => {
    const { runtime, manager } = createToolRuntime({
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    const toolCall: ToolCall = {
      id: 'tool_idempotent_1',
      type: 'function',
      index: 0,
      function: { name: 'bash', arguments: '{"command":"echo once"}' },
    };
    manager.execute = vi.fn().mockResolvedValue({ success: true, output: 'tool-once' });

    const firstEvents = await collectEvents(
      executeTool(runtime, {
        toolCall,
        stepIndex: 1,
        callbacks: createCallbacks(),
        executionId: 'exec_idempotent_1',
      })
    );
    const secondEvents = await collectEvents(
      executeTool(runtime, {
        toolCall,
        stepIndex: 1,
        callbacks: createCallbacks(),
        executionId: 'exec_idempotent_1',
      })
    );

    expect(firstEvents[0]).toMatchObject({
      type: 'tool_result',
      data: { content: 'tool-once', tool_call_id: 'tool_idempotent_1' },
    });
    expect(secondEvents[0]).toMatchObject({
      type: 'tool_result',
      data: { content: 'tool-once', tool_call_id: 'tool_idempotent_1' },
    });
    expect(manager.execute).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent duplicate tool execution with the in-memory ledger', async () => {
    const { runtime, manager } = createToolRuntime({
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    const toolCall: ToolCall = {
      id: 'tool_idempotent_race_1',
      type: 'function',
      index: 0,
      function: { name: 'bash', arguments: '{"command":"echo race"}' },
    };

    manager.execute = vi.fn().mockImplementation(
      async () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ success: true, output: 'tool-race-once' }), 20);
        })
    );

    const [eventsA, eventsB] = await Promise.all([
      collectEvents(
        executeTool(runtime, {
          toolCall,
          stepIndex: 1,
          callbacks: createCallbacks(),
          executionId: 'exec_idempotent_race_1',
        })
      ),
      collectEvents(
        executeTool(runtime, {
          toolCall,
          stepIndex: 1,
          callbacks: createCallbacks(),
          executionId: 'exec_idempotent_race_1',
        })
      ),
    ]);

    expect(eventsA[0]).toMatchObject({
      type: 'tool_result',
      data: { content: 'tool-race-once', tool_call_id: 'tool_idempotent_race_1' },
    });
    expect(eventsB[0]).toMatchObject({
      type: 'tool_result',
      data: { content: 'tool-race-once', tool_call_id: 'tool_idempotent_race_1' },
    });
    expect(manager.execute).toHaveBeenCalledTimes(1);
  });

  it('does not cache tool results by default without an external ledger', async () => {
    const { runtime, manager } = createToolRuntime();
    const toolCall: ToolCall = {
      id: 'tool_no_cache_1',
      type: 'function',
      index: 0,
      function: { name: 'bash', arguments: '{"command":"echo nc"}' },
    };

    manager.execute = vi.fn().mockResolvedValue({ success: true, output: 'tool-no-cache' });

    await collectEvents(
      executeTool(runtime, {
        toolCall,
        stepIndex: 1,
        callbacks: createCallbacks(),
        executionId: 'exec_no_cache_1',
      })
    );
    await collectEvents(
      executeTool(runtime, {
        toolCall,
        stepIndex: 1,
        callbacks: createCallbacks(),
        executionId: 'exec_no_cache_1',
      })
    );

    expect(manager.execute).toHaveBeenCalledTimes(2);
  });

  it('processToolCalls supports bounded concurrency when configured', async () => {
    vi.useFakeTimers();
    const { runtime, manager } = createToolRuntime({
      maxConcurrentToolCalls: 2,
    });
    (
      manager as unknown as { getConcurrencyPolicy: (toolCall: ToolCall) => ToolConcurrencyPolicy }
    ).getConcurrencyPolicy = vi.fn(() => ({ mode: 'parallel-safe' }));

    let inFlight = 0;
    let maxInFlight = 0;
    manager.execute = vi.fn().mockImplementation(async (toolCall: ToolCall) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return { success: true, output: `ok-${toolCall.id}` };
    });

    const messages: Message[] = [
      {
        messageId: 'm0',
        type: 'assistant-text',
        role: 'assistant',
        content: 'before',
        timestamp: 1,
      },
    ];

    const eventsPromise = collectEvents(
      processToolCalls(runtime, {
        toolCalls: [
          {
            id: 'tool_1',
            type: 'function',
            index: 0,
            function: { name: 'bash', arguments: '{"command":"echo 1"}' },
          },
          {
            id: 'tool_2',
            type: 'function',
            index: 1,
            function: { name: 'bash', arguments: '{"command":"echo 2"}' },
          },
        ],
        messages,
        stepIndex: 1,
        callbacks: createCallbacks(),
        emitProgress,
      })
    );

    await vi.advanceTimersByTimeAsync(20);
    const events = await eventsPromise;

    expect(maxInFlight).toBe(2);
    expect(events.map((event) => event.type)).toEqual([
      'progress',
      'progress',
      'tool_result',
      'tool_result',
    ]);
    expect(messages.at(-2)).toMatchObject({ tool_call_id: 'tool_1' });
    expect(messages.at(-1)).toMatchObject({ tool_call_id: 'tool_2' });
  });

  it('processToolCalls enforces lock keys for conflicting tools', async () => {
    vi.useFakeTimers();
    const { runtime, manager } = createToolRuntime({
      maxConcurrentToolCalls: 3,
    });
    (
      manager as unknown as { getConcurrencyPolicy: (toolCall: ToolCall) => ToolConcurrencyPolicy }
    ).getConcurrencyPolicy = vi.fn((toolCall: ToolCall) => ({
      mode: 'parallel-safe',
      lockKey: toolCall.id === 'tool_3' ? 'other-file' : 'same-file',
    }));

    let inFlight = 0;
    let maxInFlight = 0;
    manager.execute = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return { success: true, output: 'ok' };
    });

    const messages: Message[] = [
      {
        messageId: 'm0',
        type: 'assistant-text',
        role: 'assistant',
        content: 'before',
        timestamp: 1,
      },
    ];

    const eventsPromise = collectEvents(
      processToolCalls(runtime, {
        toolCalls: [
          {
            id: 'tool_1',
            type: 'function',
            index: 0,
            function: { name: 'bash', arguments: '{"command":"echo 1"}' },
          },
          {
            id: 'tool_2',
            type: 'function',
            index: 1,
            function: { name: 'bash', arguments: '{"command":"echo 2"}' },
          },
          {
            id: 'tool_3',
            type: 'function',
            index: 2,
            function: { name: 'bash', arguments: '{"command":"echo 3"}' },
          },
        ],
        messages,
        stepIndex: 1,
        callbacks: createCallbacks(),
        emitProgress,
      })
    );

    await vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(20);
    await eventsPromise;

    expect(maxInFlight).toBe(2);
    expect(manager.execute).toHaveBeenCalledTimes(3);
  });

  it('processToolCalls supports mixed exclusive and parallel execution waves', async () => {
    const { runtime, manager } = createToolRuntime({
      maxConcurrentToolCalls: 3,
      toolConcurrencyPolicyResolver: (toolCall: ToolCall) =>
        toolCall.id === 'tool_exclusive' ? { mode: 'exclusive' } : { mode: 'parallel-safe' },
    });

    manager.execute = vi.fn().mockImplementation(async (toolCall: ToolCall) => ({
      success: true,
      output: `ok-${toolCall.id}`,
    }));

    const messages: Message[] = [
      {
        messageId: 'm0',
        type: 'assistant-text',
        role: 'assistant',
        content: 'before',
        timestamp: 1,
      },
    ];

    const events = await collectEvents(
      processToolCalls(runtime, {
        toolCalls: [
          {
            id: 'tool_exclusive',
            type: 'function',
            index: 0,
            function: { name: 'bash', arguments: '{"command":"echo e"}' },
          },
          {
            id: 'tool_parallel',
            type: 'function',
            index: 1,
            function: { name: 'bash', arguments: '{"command":"echo p"}' },
          },
        ],
        messages,
        stepIndex: 1,
        callbacks: createCallbacks(),
        emitProgress,
      })
    );

    expect(events.map((event) => event.type)).toEqual([
      'progress',
      'progress',
      'tool_result',
      'tool_result',
    ]);
    expect(messages.at(-2)).toMatchObject({ tool_call_id: 'tool_exclusive' });
    expect(messages.at(-1)).toMatchObject({ tool_call_id: 'tool_parallel' });
  });

  it('executeTool falls back to summary content when a successful tool has no output', async () => {
    const { runtime, manager } = createToolRuntime();
    manager.execute = vi.fn().mockResolvedValue({ success: true });

    const events = await collectEvents(
      executeTool(runtime, {
        toolCall: {
          id: 'call_no_output',
          type: 'function',
          index: 0,
          function: { name: 'bash', arguments: '{}' },
        },
        stepIndex: 1,
        callbacks: createCallbacks(),
      })
    );

    expect(events[0]).toMatchObject({
      type: 'tool_result',
      data: {
        content: 'Command completed successfully with no output.',
        tool_call_id: 'call_no_output',
        metadata: {
          toolResult: {
            summary: 'Command completed successfully with no output.',
            success: true,
          },
        },
      },
    });
  });

  it('executeTool uses an explicit tool error message when present', async () => {
    const { runtime, manager } = createToolRuntime();
    manager.execute = vi.fn().mockResolvedValue({
      success: false,
      error: { message: 'tool failed explicitly' } as { message: string },
    });

    const events = await collectEvents(
      executeTool(runtime, {
        toolCall: {
          id: 'call_err_message',
          type: 'function',
          index: 0,
          function: { name: 'bash', arguments: '{}' },
        },
        stepIndex: 1,
        callbacks: createCallbacks(),
      })
    );

    expect(events[0]).toMatchObject({
      type: 'tool_result',
      data: { content: 'Command failed: tool failed explicitly', tool_call_id: 'call_err_message' },
    });
  });

  it('marks tool metrics as unsuccessful when a tool returns a failed result without an error code', async () => {
    const metrics: MetricRecord = [];
    const { runtime, manager } = createToolRuntime({ metrics });
    manager.execute = vi.fn().mockResolvedValue({
      success: false,
      error: { message: 'tool failed without code' },
    });

    const events = await collectEvents(
      executeTool(runtime, {
        toolCall: {
          id: 'call_err_no_code',
          type: 'function',
          index: 0,
          function: { name: 'bash', arguments: '{}' },
        },
        stepIndex: 1,
        callbacks: createCallbacks(),
      })
    );

    expect(events[0]).toMatchObject({
      type: 'tool_result',
      data: {
        content: 'Command failed: tool failed without code',
        tool_call_id: 'call_err_no_code',
      },
    });

    const toolMetric = metrics.find((metric) => metric.name === 'agent.tool.duration_ms');
    expect(toolMetric).toBeDefined();
    expect(toolMetric?.tags?.success).toBe('false');
  });

  it('marks tool metrics as unsuccessful when tool execution throws', async () => {
    const metrics: MetricRecord = [];
    const { runtime, manager } = createToolRuntime({ metrics });
    manager.execute = vi.fn().mockRejectedValue(new Error('chaos tool crash'));

    await expect(
      collectEvents(
        executeTool(runtime, {
          toolCall: {
            id: 'call_throw',
            type: 'function',
            index: 0,
            function: { name: 'bash', arguments: '{}' },
          },
          stepIndex: 1,
          callbacks: createCallbacks(),
        })
      )
    ).rejects.toThrow('chaos tool crash');

    const toolMetric = metrics.find((metric) => metric.name === 'agent.tool.duration_ms');
    expect(toolMetric).toBeDefined();
    expect(toolMetric?.tags?.success).toBe('false');
  });

  it('resolveToolConcurrencyPolicy falls back to manager policy and then to exclusive', () => {
    const managerWithPolicy = createToolManager();
    const { runtime: withManagerPolicy } = createToolRuntime({ manager: managerWithPolicy });
    expect(
      resolveToolConcurrencyPolicy(withManagerPolicy, {
        id: 'tool_1',
        type: 'function',
        index: 0,
        function: { name: 'bash', arguments: '{}' },
      })
    ).toEqual({ mode: 'exclusive' });

    const managerWithoutPolicy = createToolManager();
    (managerWithoutPolicy as unknown as { getConcurrencyPolicy?: unknown }).getConcurrencyPolicy =
      undefined;
    const { runtime: fallbackDeps } = createToolRuntime({ manager: managerWithoutPolicy });
    expect(
      resolveToolConcurrencyPolicy(fallbackDeps, {
        id: 'tool_2',
        type: 'function',
        index: 0,
        function: { name: 'bash', arguments: '{}' },
      })
    ).toEqual({ mode: 'exclusive' });
  });
});
