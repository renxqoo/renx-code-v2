import type { Message, StreamEvent } from '../types';
import type { ToolConcurrencyPolicy } from '../tool/types';
import type { ToolCall } from '../../providers';

import { generateId } from './shared';
import {
  createNoopObservation,
  type AgentRuntimeObservation,
  type ToolExecutionLifecycleFinishContext,
} from './runtime-hooks';
import {
  buildExecutionWaves as buildToolExecutionWaves,
  processToolCallBatch,
} from './tool-runtime-batch';
import { executeToolWithLedger } from './tool-runtime-execution';
import type {
  ExecuteToolArgs,
  ProcessToolCallsArgs,
  ToolExecutionPlan,
  ToolRuntime,
} from './tool-runtime-types';

export type { ExecuteToolArgs, ProcessToolCallsArgs, ToolRuntime } from './tool-runtime-types';

export function resolveToolConcurrencyPolicy(
  runtime: ToolRuntime,
  toolCall: ToolCall
): ToolConcurrencyPolicy {
  // Prefer explicit runtime overrides, then fall back to executor defaults.
  // This keeps orchestration policy replaceable without coupling the rest of
  // the pipeline to one executor implementation.
  if (runtime.execution.resolveConcurrencyPolicy) {
    return runtime.execution.resolveConcurrencyPolicy(toolCall);
  }

  if (typeof runtime.execution.executor.getConcurrencyPolicy === 'function') {
    return runtime.execution.executor.getConcurrencyPolicy(toolCall);
  }

  return { mode: 'exclusive' };
}

export function buildExecutionWaves(
  plans: ToolExecutionPlan[]
): Array<{ type: 'exclusive' | 'parallel'; plans: ToolExecutionPlan[] }> {
  return buildToolExecutionWaves(plans);
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
    writeBufferSessions = new Map(),
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
    const result = await executeToolWithLedger(runtime, {
      toolCall,
      stepIndex,
      callbacks,
      abortSignal,
      executionId,
      traceId,
      parentSpanId,
      writeBufferSessions,
    });
    cachedHit = result.fromCache;
    toolSucceeded = result.success;
    toolErrorCode = result.errorCode;

    yield {
      type: 'tool_result',
      data: result.replayResult,
    };

    return result.replayResult;
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
  args: ProcessToolCallsArgs
): AsyncGenerator<StreamEvent, Message, unknown> {
  return yield* processToolCallBatch(runtime, args, {
    executeTool,
    resolveConcurrencyPolicy: resolveToolConcurrencyPolicy,
  });
}
