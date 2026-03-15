import type { Message, StreamEvent } from '../types';

import type {
  ExecuteToolArgs,
  ProcessToolCallsArgs,
  ToolExecutionPlan,
  ToolRuntime,
  ToolTaskResult,
} from './tool-runtime-types';
import {
  buildExecutionWaves as buildToolExecutionWaves,
  runWithConcurrencyAndLock as runTasksWithConcurrencyAndLock,
} from './concurrency';

async function executeToolTask(
  executeToolFn: (
    runtime: ToolRuntime,
    args: ExecuteToolArgs
  ) => AsyncGenerator<StreamEvent, Message, unknown>,
  runtime: ToolRuntime,
  args: ExecuteToolArgs
): Promise<ToolTaskResult> {
  const events: StreamEvent[] = [];
  const toolGen = executeToolFn(runtime, args);
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
  executeToolFn: (
    runtime: ToolRuntime,
    args: ExecuteToolArgs
  ) => AsyncGenerator<StreamEvent, Message, unknown>,
  runtime: ToolRuntime,
  plans: ToolExecutionPlan[],
  args: Omit<ExecuteToolArgs, 'toolCall'>
): Promise<ToolTaskResult[]> {
  const tasks = plans.map((plan) => ({
    lockKey: plan.policy.lockKey,
    run: async () =>
      executeToolTask(executeToolFn, runtime, {
        ...args,
        toolCall: plan.toolCall,
      }),
  }));

  return runTasksWithConcurrencyAndLock(tasks, runtime.execution.maxConcurrentToolCalls);
}

export function buildExecutionWaves(
  plans: ToolExecutionPlan[]
): Array<{ type: 'exclusive' | 'parallel'; plans: ToolExecutionPlan[] }> {
  // Convert per-tool policies into execution waves so the scheduler can reason
  // about "what may run together" once, then execute deterministically.
  return buildToolExecutionWaves(plans);
}

export async function* processToolCallBatch(
  runtime: ToolRuntime,
  args: ProcessToolCallsArgs,
  deps: {
    executeTool: (
      runtime: ToolRuntime,
      args: ExecuteToolArgs
    ) => AsyncGenerator<StreamEvent, Message, unknown>;
    resolveConcurrencyPolicy: (
      runtime: ToolRuntime,
      toolCall: ToolExecutionPlan['toolCall']
    ) => ToolExecutionPlan['policy'];
  }
): AsyncGenerator<StreamEvent, Message, unknown> {
  const {
    toolCalls,
    messages,
    stepIndex,
    callbacks,
    abortSignal,
    executionId,
    traceId,
    parentSpanId,
    writeBufferSessions = new Map(),
    emitProgress,
  } = args;

  if (runtime.execution.maxConcurrentToolCalls <= 1 || toolCalls.length <= 1) {
    // Keep the simple path simple: sequential execution is easier to debug and
    // preserves intuitive ordering when concurrency is disabled or unnecessary.
    for (const toolCall of toolCalls) {
      runtime.resilience.throwIfAborted(abortSignal);
      yield* emitProgress(executionId, stepIndex, 'tool', messages.length);

      const result = await executeToolTask(deps.executeTool, runtime, {
        toolCall,
        stepIndex,
        callbacks,
        abortSignal,
        executionId,
        traceId,
        parentSpanId,
        writeBufferSessions,
      });
      for (const event of result.events) {
        yield event;
      }
      if (result.message) {
        messages.push(result.message);
      }
    }

    return messages[messages.length - 1];
  }

  const plans = toolCalls.map((toolCall) => ({
    toolCall,
    policy: deps.resolveConcurrencyPolicy(runtime, toolCall),
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
        await executeToolTask(deps.executeTool, runtime, {
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
    const parallelResults = await runParallelWave(deps.executeTool, runtime, wave.plans, {
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
