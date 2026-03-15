import type { Message, StreamEvent } from '../types';
import type { ToolCall } from '../../providers';

import type { LLMStreamResult } from './llm-stream-runtime';
import { createNoopObservation } from './runtime-hooks';
import type { RunLoopRuntime, RunLoopState } from './run-loop';

async function* forwardEvents<T>(
  generator: AsyncGenerator<StreamEvent, T, unknown>
): AsyncGenerator<StreamEvent, T, unknown> {
  // Stage generators stream intermediate events before returning a structured
  // result. This helper lets the outer run loop consume both through one
  // consistent `yield*` boundary.
  for (;;) {
    const next = await generator.next();
    if (next.done) {
      return next.value;
    }
    yield next.value as StreamEvent;
  }
}

export async function* runLLMStage(
  runtime: RunLoopRuntime,
  state: RunLoopState,
  stepIndex: number
): AsyncGenerator<StreamEvent, LLMStreamResult, unknown> {
  // Stage-level observations wrap the entire LLM interaction, including stream
  // consumption and post-stream validation, so latency/error metrics match the
  // business step the agent actually reasons about.
  const llmObservation =
    (await runtime.hooks.onLLMStageStart?.({
      callbacks: state.callbacks,
      traceId: state.traceId,
      parentSpanId: state.runObservation.spanId,
      executionId: state.input.executionId,
      stepIndex,
      messageCount: state.messages.length,
    })) ?? createNoopObservation();
  const llmScope = runtime.resilience.createStageAbortScope(
    state.abortSignal,
    state.timeoutBudget,
    'llm'
  );
  let llmErrorCode: string | undefined;
  let llmSucceeded = false;

  try {
    const result = yield* forwardEvents(
      runtime.stages.llm(
        state.messages,
        runtime.messages.mergeLLMConfig(
          state.input.config,
          state.effectiveTools,
          llmScope.signal,
          state.input.conversationId
        ),
        llmScope.signal,
        state.input.executionId,
        stepIndex,
        state.writeBufferSessions
      )
    );
    runtime.resilience.throwIfAborted(llmScope.signal);
    llmSucceeded = true;
    return result;
  } catch (error) {
    llmErrorCode = runtime.diagnostics.extractErrorCode(error) || 'AGENT_LLM_STAGE_FAILED';
    throw error;
  } finally {
    llmScope.release();
    const llmLatencyMs = Date.now() - llmObservation.startedAt;
    await llmObservation.finish({
      callbacks: state.callbacks,
      traceId: state.traceId,
      executionId: state.input.executionId,
      stepIndex,
      latencyMs: llmLatencyMs,
      success: llmSucceeded,
      errorCode: llmErrorCode,
      messageCount: state.messages.length,
    });
  }
}

export async function* runToolStage(
  runtime: RunLoopRuntime,
  state: RunLoopState,
  stepIndex: number,
  toolCalls: ToolCall[]
): AsyncGenerator<StreamEvent, Message, unknown> {
  // This stage measures the orchestration cost of the full tool batch produced
  // by one assistant turn. Individual tool timings are recorded deeper in the
  // tool runtime.
  const toolStageObservation =
    (await runtime.hooks.onToolStageStart?.({
      callbacks: state.callbacks,
      traceId: state.traceId,
      parentSpanId: state.runObservation.spanId,
      executionId: state.input.executionId,
      stepIndex,
      toolCalls: toolCalls.length,
    })) ?? createNoopObservation();
  const toolScope = runtime.resilience.createStageAbortScope(
    state.abortSignal,
    state.timeoutBudget,
    'tool'
  );
  let toolStageErrorCode: string | undefined;
  let toolStageSucceeded = false;

  try {
    const result = yield* forwardEvents(
      runtime.stages.tools(
        toolCalls,
        state.messages,
        stepIndex,
        state.callbacks,
        toolScope.signal,
        state.input.executionId,
        state.traceId,
        toolStageObservation.spanId,
        state.writeBufferSessions
      )
    );
    toolStageSucceeded = true;
    return result;
  } catch (error) {
    toolStageErrorCode = runtime.diagnostics.extractErrorCode(error) || 'AGENT_TOOL_STAGE_FAILED';
    throw error;
  } finally {
    toolScope.release();
    const toolStageLatencyMs = Date.now() - toolStageObservation.startedAt;
    await toolStageObservation.finish({
      callbacks: state.callbacks,
      traceId: state.traceId,
      executionId: state.input.executionId,
      stepIndex,
      latencyMs: toolStageLatencyMs,
      success: toolStageSucceeded,
      errorCode: toolStageErrorCode,
      toolCalls: toolCalls.length,
    });
  }
}
