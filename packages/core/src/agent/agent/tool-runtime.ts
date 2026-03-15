import type { AgentCallbacks, Message, StreamEvent, ToolDecision } from '../types';
import { ToolManager } from '../tool/tool-manager';
import type { ToolConcurrencyPolicy } from '../tool/types';
import type { ToolCall } from '../../providers';

import { UnknownError } from './error';
import {
  buildExecutionWaves as buildToolExecutionWaves,
  runWithConcurrencyAndLock as runTasksWithConcurrencyAndLock,
} from './concurrency';
import {
  buildWriteFileSessionKey,
  cleanupWriteFileBufferIfNeeded,
  enrichWriteFileToolError,
  isWriteFileProtocolOutput,
  isWriteFileToolCall,
  parseWriteFileProtocolOutput,
  shouldEnrichWriteFileFailure,
  type WriteBufferRuntime,
} from './write-file-session';
import { executeToolCallWithLedger, type ToolExecutionLedger } from './tool-execution-ledger';
import { createToolResultMessageFromLedger, resolveToolResultSummary } from './tool-result';
import { generateId } from './shared';
import type { ToolResult } from '../tool/base-tool';
import {
  createNoopObservation,
  type AgentRuntimeLifecycleHooks,
  type AgentRuntimeObservation,
  type ToolExecutionLifecycleFinishContext,
} from './runtime-hooks';

type ToolTaskResult = { events: StreamEvent[]; message?: Message };
type ToolExecutionPlan = { toolCall: ToolCall; policy: ToolConcurrencyPolicy };

export type ToolRuntime = {
  agentRef: unknown;
  execution: {
    manager: ToolManager;
    ledger: ToolExecutionLedger;
    maxConcurrentToolCalls: number;
    resolveConcurrencyPolicy?: (toolCall: ToolCall) => ToolConcurrencyPolicy;
  };
  callbacks: {
    safe: <T>(
      callback: ((arg: T) => void | Promise<void>) | undefined,
      arg: T
    ) => Promise<void>;
  };
  diagnostics: {
    extractErrorCode: (error: unknown) => string | undefined;
    logError: (message: string, error: unknown, context?: Record<string, unknown>) => void;
  };
  resilience: {
    throwIfAborted: (signal?: AbortSignal) => void;
  };
  hooks: AgentRuntimeLifecycleHooks;
  events: {
    emit: (eventName: 'tool_chunk' | 'tool_confirm', payload: unknown) => void;
  };
};

type ExecuteToolArgs = {
  toolCall: ToolCall;
  stepIndex: number;
  callbacks?: AgentCallbacks;
  abortSignal?: AbortSignal;
  executionId?: string;
  traceId?: string;
  parentSpanId?: string;
  writeBufferSessions?: Map<string, WriteBufferRuntime>;
};

type ProcessToolCallsArgs = {
  toolCalls: ToolCall[];
  messages: Message[];
  stepIndex: number;
  callbacks?: AgentCallbacks;
  abortSignal?: AbortSignal;
  executionId?: string;
  traceId?: string;
  parentSpanId?: string;
  writeBufferSessions?: Map<string, WriteBufferRuntime>;
  emitProgress: (
    executionId: string | undefined,
    stepIndex: number,
    currentAction: 'llm' | 'tool',
    messageCount: number
  ) => Generator<StreamEvent>;
};

export function resolveToolConcurrencyPolicy(
  runtime: ToolRuntime,
  toolCall: ToolCall
): ToolConcurrencyPolicy {
  // Prefer explicit runtime overrides, then fall back to ToolManager defaults.
  // This keeps orchestration policy replaceable without coupling the rest of
  // the pipeline to one manager implementation.
  if (runtime.execution.resolveConcurrencyPolicy) {
    return runtime.execution.resolveConcurrencyPolicy(toolCall);
  }

  const manager = runtime.execution.manager as ToolManager & {
    getConcurrencyPolicy?: (call: ToolCall) => ToolConcurrencyPolicy;
  };
  if (typeof manager.getConcurrencyPolicy === 'function') {
    return manager.getConcurrencyPolicy(toolCall);
  }

  return { mode: 'exclusive' };
}

export function buildExecutionWaves(
  plans: ToolExecutionPlan[]
): Array<{ type: 'exclusive' | 'parallel'; plans: ToolExecutionPlan[] }> {
  // Convert per-tool policies into execution waves so the scheduler can reason
  // about "what may run together" once, then execute deterministically.
  return buildToolExecutionWaves(plans);
}

async function executeToolTask(
  runtime: ToolRuntime,
  args: ExecuteToolArgs
): Promise<ToolTaskResult> {
  const events: StreamEvent[] = [];
  const toolGen = executeTool(runtime, args);
  let resultMessage: Message | undefined;

  for (;;) {
    const next = await toolGen.next();
    if (next.done) {
      resultMessage = next.value;
      break;
    }
    events.push(next.value as StreamEvent);
  }

  return {
    events,
    message: resultMessage,
  };
}

async function runParallelWave(
  runtime: ToolRuntime,
  plans: ToolExecutionPlan[],
  args: Omit<ExecuteToolArgs, 'toolCall'>
): Promise<ToolTaskResult[]> {
  const tasks = plans.map((plan) => ({
    lockKey: plan.policy.lockKey,
    run: async () =>
      executeToolTask(runtime, {
        ...args,
        toolCall: plan.toolCall,
      }),
  }));

  return runTasksWithConcurrencyAndLock(tasks, runtime.execution.maxConcurrentToolCalls);
}

async function maybeAutoFinalizeWriteFileResult(
  runtime: ToolRuntime,
  params: {
    toolCall: ToolCall;
    toolOutput: string;
    stepIndex: number;
    abortSignal?: AbortSignal;
  }
): Promise<ToolResult> {
  const { toolCall, toolOutput, stepIndex, abortSignal } = params;
  if (!isWriteFileToolCall(toolCall)) {
    return {
      success: false,
      output: toolOutput,
    };
  }

  const protocol = parseWriteFileProtocolOutput(toolOutput);
  if (
    !protocol ||
    protocol.code !== 'WRITE_FILE_PARTIAL_BUFFERED' ||
    protocol.nextAction !== 'finalize'
  ) {
    return {
      success: false,
      output: toolOutput,
    };
  }

  const bufferId = protocol.nextArgs?.bufferId || protocol.buffer?.bufferId;
  const finalizePath = protocol.nextArgs?.path || protocol.buffer?.path || undefined;
  if (!bufferId) {
    return {
      success: false,
      output: toolOutput,
    };
  }

  const finalizeToolCall: ToolCall = {
    id: `${toolCall.id}__finalize`,
    type: toolCall.type,
    index: toolCall.index,
    function: {
      name: toolCall.function.name,
      arguments: JSON.stringify({
        mode: 'finalize',
        bufferId,
        ...(finalizePath ? { path: finalizePath } : {}),
      }),
    },
  };

  // Buffered write_file protocols intentionally split "receive content" from
  // "commit to disk". When only finalize remains, we complete it here so the
  // outer loop still observes a single logical tool result.
  runtime.resilience.throwIfAborted(abortSignal);
  return runtime.execution.manager.execute(finalizeToolCall, {
    toolCallId: finalizeToolCall.id,
    loopIndex: stepIndex,
    agent: runtime.agentRef,
    toolAbortSignal: abortSignal,
  });
}

export async function* executeTool(
  runtime: ToolRuntime,
  {
    toolCall,
    stepIndex,
    callbacks,
    abortSignal,
    executionId,
    traceId,
    parentSpanId,
    writeBufferSessions = new Map<string, WriteBufferRuntime>(),
  }: ExecuteToolArgs
): AsyncGenerator<StreamEvent, Message, unknown> {
  runtime.resilience.throwIfAborted(abortSignal);
  const effectiveTraceId = traceId || executionId || generateId('trace_');
  const toolObservation: AgentRuntimeObservation<ToolExecutionLifecycleFinishContext> =
    (await runtime.hooks.onToolExecutionStart?.({
      callbacks,
      traceId: effectiveTraceId,
      parentSpanId,
      executionId,
      stepIndex,
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
    })) ?? createNoopObservation();

  let toolErrorCode: string | undefined;
  let cachedHit = false;
  let toolSucceeded = false;

  try {
    // The ledger is the stateless agent's idempotency boundary. If a retry or
    // replay re-enters the same toolCallId, we can reuse the recorded result
    // instead of executing side effects again.
    const writeFileSessionKey = buildWriteFileSessionKey({
      executionId,
      stepIndex,
      toolCallId: toolCall.id,
    });

    const ledgerResult = await executeToolCallWithLedger({
      ledger: runtime.execution.ledger,
      executionId,
      toolCallId: toolCall.id,
      execute: async () => {
        const toolExecResult = await runtime.execution.manager.execute(toolCall, {
          onChunk: (chunk) => {
            runtime.events.emit('tool_chunk', {
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              arguments: toolCall.function.arguments,
              chunk: chunk.data,
              chunkType: chunk.type,
            });
          },
          onConfirm: async (info) =>
            new Promise<ToolDecision>((resolve) => {
              let settled = false;
              const abortHandler = () => {
                if (!settled) {
                  settled = true;
                  resolve({ approved: false, message: 'Operation aborted' });
                }
              };

              const cleanup = () => {
                if (!settled) {
                  settled = true;
                }
                abortSignal?.removeEventListener('abort', abortHandler);
              };

              if (abortSignal?.aborted) {
                abortHandler();
                return;
              }

              abortSignal?.addEventListener('abort', abortHandler, { once: true });
              runtime.events.emit('tool_confirm', {
                ...info,
                resolve: (decision: ToolDecision) => {
                  cleanup();
                  resolve(decision);
                },
              });
            }),
          onPolicyCheck: callbacks?.onToolPolicy
            ? async (info) => {
                const decision = await callbacks.onToolPolicy?.(info);
                return decision || { allowed: true };
              }
            : undefined,
          toolCallId: toolCall.id,
          loopIndex: stepIndex,
          agent: runtime.agentRef,
          toolAbortSignal: abortSignal,
        });

        let toolOutput = '';
        let errorCode: string | undefined;

        if (toolExecResult.success) {
          toolOutput = toolExecResult.output || '';
          await cleanupWriteFileBufferIfNeeded(
            toolCall,
            writeBufferSessions,
            writeFileSessionKey
          );
        } else {
          if (isWriteFileToolCall(toolCall)) {
            // write_file failures are special because the model may stream a
            // large payload incrementally. Preserve or enrich protocol data so
            // the model can recover deterministically instead of seeing a lossy
            // generic error string.
            if (isWriteFileProtocolOutput(toolExecResult.output)) {
              toolOutput = toolExecResult.output;
            } else if (
              shouldEnrichWriteFileFailure(toolExecResult.error, toolExecResult.output)
            ) {
              const errorContent =
                toolExecResult.error?.message ||
                toolExecResult.output ||
                new UnknownError().message;
              toolOutput = await enrichWriteFileToolError(
                toolCall,
                errorContent,
                writeBufferSessions,
                writeFileSessionKey
              );
            } else {
              toolOutput =
                toolExecResult.error?.message ||
                toolExecResult.output ||
                new UnknownError().message;
            }

            if (isWriteFileProtocolOutput(toolOutput)) {
              const finalizeResult = await maybeAutoFinalizeWriteFileResult(runtime, {
                toolCall,
                toolOutput,
                stepIndex,
                abortSignal,
              });
              if (finalizeResult.success) {
                toolOutput = finalizeResult.output || '';
                errorCode = undefined;
                await cleanupWriteFileBufferIfNeeded(
                  toolCall,
                  writeBufferSessions,
                  writeFileSessionKey
                );
                return {
                  success: true,
                  output: toolOutput,
                  summary: resolveToolResultSummary(toolCall, finalizeResult, toolOutput),
                  payload: finalizeResult.payload,
                  metadata: finalizeResult.metadata,
                  errorName: undefined,
                  errorMessage: undefined,
                  errorCode,
                  recordedAt: Date.now(),
                };
              }
            }
          } else {
            toolOutput =
              toolExecResult.error?.message ||
              toolExecResult.output ||
              new UnknownError().message;
          }

          errorCode =
            runtime.diagnostics.extractErrorCode(toolExecResult.error) ||
            'TOOL_EXECUTION_FAILED';
        }

        return {
          success: toolExecResult.success,
          output: toolOutput,
          summary: resolveToolResultSummary(toolCall, toolExecResult, toolOutput),
          payload: toolExecResult.payload,
          metadata: toolExecResult.metadata,
          errorName: toolExecResult.error?.name,
          errorMessage: toolExecResult.error?.message,
          errorCode,
          recordedAt: Date.now(),
        };
      },
      onError: (error) => {
        runtime.diagnostics.logError('[Agent] Failed to execute tool with ledger:', error, {
          executionId,
          stepIndex,
          toolCallId: toolCall.id,
        });
      },
    });

    cachedHit = ledgerResult.fromCache;
    toolSucceeded = ledgerResult.record.success;
    toolErrorCode = ledgerResult.record.errorCode;

    // Rebuild a normal tool-result message from the ledger record so callers
    // do not need to care whether the result came from fresh execution or
    // replay.
    const replayResult = createToolResultMessageFromLedger(
      toolCall.id,
      ledgerResult.record,
      () => generateId('msg_')
    );
    await runtime.callbacks.safe(callbacks?.onMessage, replayResult);

    yield {
      type: 'tool_result',
      data: replayResult,
    };

    return replayResult;
  } catch (error) {
    toolErrorCode = runtime.diagnostics.extractErrorCode(error) || 'TOOL_EXECUTION_FAILED';
    throw error;
  } finally {
    const toolLatencyMs = Date.now() - toolObservation.startedAt;
    await toolObservation.finish({
      callbacks,
      traceId: effectiveTraceId,
      executionId,
      stepIndex,
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      latencyMs: toolLatencyMs,
      cached: cachedHit,
      success: toolSucceeded,
      errorCode: toolErrorCode,
    });
  }
}

export async function* processToolCalls(
  runtime: ToolRuntime,
  {
    toolCalls,
    messages,
    stepIndex,
    callbacks,
    abortSignal,
    executionId,
    traceId,
    parentSpanId,
    writeBufferSessions = new Map<string, WriteBufferRuntime>(),
    emitProgress,
  }: ProcessToolCallsArgs
): AsyncGenerator<StreamEvent, Message, unknown> {
  if (runtime.execution.maxConcurrentToolCalls <= 1 || toolCalls.length <= 1) {
    // Keep the simple path simple: sequential execution is easier to debug and
    // preserves intuitive ordering when concurrency is disabled or unnecessary.
    for (const toolCall of toolCalls) {
      runtime.resilience.throwIfAborted(abortSignal);
      yield* emitProgress(executionId, stepIndex, 'tool', messages.length);

      const toolGen = executeTool(runtime, {
        toolCall,
        stepIndex,
        callbacks,
        abortSignal,
        executionId,
        traceId,
        parentSpanId,
        writeBufferSessions,
      });
      let resultMessage: Message | undefined;

      for (;;) {
        const next = await toolGen.next();
        if (next.done) {
          resultMessage = next.value;
          break;
        }
        yield next.value as StreamEvent;
      }

      if (resultMessage) {
        messages.push(resultMessage);
      }
    }

    return messages[messages.length - 1];
  }

  const plans = toolCalls.map((toolCall) => ({
    toolCall,
    policy: resolveToolConcurrencyPolicy(runtime, toolCall),
  }));

  // Emit progress before each planned tool task so stream consumers can track
  // the batch size even when actual execution later happens in grouped waves.
  for (let i = 0; i < plans.length; i += 1) {
    runtime.resilience.throwIfAborted(abortSignal);
    yield* emitProgress(executionId, stepIndex, 'tool', messages.length);
  }

  const waves = buildExecutionWaves(plans);
  const allResults: ToolTaskResult[] = [];

  for (const wave of waves) {
    runtime.resilience.throwIfAborted(abortSignal);

    if (wave.type === 'exclusive') {
      // Exclusive waves preserve original order for tools that declare side
      // effects or locking requirements.
      allResults.push(
        await executeToolTask(runtime, {
          toolCall: wave.plans[0].toolCall,
          stepIndex,
          callbacks,
          abortSignal,
          executionId,
          traceId,
          parentSpanId,
          writeBufferSessions,
        })
      );
      continue;
    }

    // Parallel waves are still lock-aware. The concurrency helper enforces
    // both the global ceiling and per-lock serialization.
    const parallelResults = await runParallelWave(runtime, wave.plans, {
      stepIndex,
      callbacks,
      abortSignal,
      executionId,
      traceId,
      parentSpanId,
      writeBufferSessions,
    });
    allResults.push(...parallelResults);
  }

  // Delay mutation of shared message history until wave execution finishes.
  // That avoids partially-applied conversation state if one parallel task
  // throws before the batch is complete.
  for (const taskResult of allResults) {
    for (const event of taskResult.events) {
      yield event;
    }
    if (taskResult.message) {
      messages.push(taskResult.message);
    }
    runtime.resilience.throwIfAborted(abortSignal);
  }

  return messages[messages.length - 1];
}
