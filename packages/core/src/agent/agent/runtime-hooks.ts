import type { AgentCallbacks } from '../types';

export type AgentRunOutcome =
  | 'done'
  | 'error'
  | 'aborted'
  | 'timeout'
  | 'max_retries'
  | 'max_steps';

/**
 * A lifecycle observation is the hook-friendly abstraction for "start now,
 * finish later with outcome data". Hooks can allocate spans/timers on start
 * and close them when the runtime hands back the finish context.
 */
export interface AgentRuntimeObservation<TFinishContext> {
  spanId?: string;
  startedAt: number;
  finish(context: TFinishContext): Promise<void>;
}

export interface RunLifecycleStartContext {
  callbacks?: AgentCallbacks;
  traceId: string;
  executionId?: string;
  conversationId?: string;
  maxSteps: number;
  timeoutBudgetMs?: number;
}

export interface RunLifecycleFinishContext {
  callbacks?: AgentCallbacks;
  traceId: string;
  executionId?: string;
  stepIndex: number;
  latencyMs: number;
  outcome: AgentRunOutcome;
  errorCode?: string;
  retryCount: number;
}

export interface LLMStageLifecycleStartContext {
  callbacks?: AgentCallbacks;
  traceId: string;
  parentSpanId?: string;
  executionId?: string;
  stepIndex: number;
  messageCount: number;
}

export interface LLMStageLifecycleFinishContext {
  callbacks?: AgentCallbacks;
  traceId: string;
  executionId?: string;
  stepIndex: number;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
  messageCount: number;
}

export interface ToolStageLifecycleStartContext {
  callbacks?: AgentCallbacks;
  traceId: string;
  parentSpanId?: string;
  executionId?: string;
  stepIndex: number;
  toolCalls: number;
}

export interface ToolStageLifecycleFinishContext {
  callbacks?: AgentCallbacks;
  traceId: string;
  executionId?: string;
  stepIndex: number;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
  toolCalls: number;
}

export interface ToolExecutionLifecycleStartContext {
  callbacks?: AgentCallbacks;
  traceId: string;
  parentSpanId?: string;
  executionId?: string;
  stepIndex: number;
  toolCallId: string;
  toolName: string;
}

export interface ToolExecutionLifecycleFinishContext {
  callbacks?: AgentCallbacks;
  traceId: string;
  executionId?: string;
  stepIndex: number;
  toolCallId: string;
  toolName: string;
  latencyMs: number;
  cached: boolean;
  success: boolean;
  errorCode?: string;
}

export interface RunErrorLifecycleContext {
  executionId?: string;
  traceId: string;
  stepIndex: number;
  retryCount: number;
  errorCode?: string;
  category?: string;
  error: unknown;
}

export interface RetryScheduledLifecycleContext {
  executionId?: string;
  traceId: string;
  stepIndex: number;
  retryCount: number;
  errorCode?: string;
}

export interface AgentRuntimeLifecycleHooks {
  onRunStart?(
    context: RunLifecycleStartContext
  ):
    | Promise<AgentRuntimeObservation<RunLifecycleFinishContext> | void>
    | AgentRuntimeObservation<RunLifecycleFinishContext>
    | void;
  onLLMStageStart?(
    context: LLMStageLifecycleStartContext
  ):
    | Promise<AgentRuntimeObservation<LLMStageLifecycleFinishContext> | void>
    | AgentRuntimeObservation<LLMStageLifecycleFinishContext>
    | void;
  onToolStageStart?(
    context: ToolStageLifecycleStartContext
  ):
    | Promise<AgentRuntimeObservation<ToolStageLifecycleFinishContext> | void>
    | AgentRuntimeObservation<ToolStageLifecycleFinishContext>
    | void;
  onToolExecutionStart?(
    context: ToolExecutionLifecycleStartContext
  ):
    | Promise<AgentRuntimeObservation<ToolExecutionLifecycleFinishContext> | void>
    | AgentRuntimeObservation<ToolExecutionLifecycleFinishContext>
    | void;
  onRunError?(context: RunErrorLifecycleContext): Promise<void> | void;
  onRetryScheduled?(context: RetryScheduledLifecycleContext): Promise<void> | void;
}

export function createNoopObservation<TFinishContext>(
  startedAt = Date.now()
): AgentRuntimeObservation<TFinishContext> {
  return {
    startedAt,
    async finish(): Promise<void> {
      return;
    },
  };
}

function mergeObservations<TFinishContext>(
  observations: AgentRuntimeObservation<TFinishContext>[]
): AgentRuntimeObservation<TFinishContext> {
  if (observations.length === 0) {
    return createNoopObservation<TFinishContext>();
  }

  return {
    // Reuse the first concrete span id we have so downstream child spans still
    // have one stable parent even when multiple hook implementations are
    // composed together.
    spanId: observations.find((observation) => observation.spanId)?.spanId,
    startedAt: Math.min(...observations.map((observation) => observation.startedAt)),
    async finish(context: TFinishContext): Promise<void> {
      for (const observation of observations) {
        await observation.finish(context);
      }
    },
  };
}

export function composeAgentRuntimeHooks(
  hooks: AgentRuntimeLifecycleHooks[]
): AgentRuntimeLifecycleHooks {
  // Composition keeps runtime code closed for modification: the agent emits a
  // fixed set of lifecycle events, while observability/audit extensions can be
  // added by stacking hooks instead of editing orchestration code.
  return {
    async onRunStart(context) {
      const observations = await Promise.all(
        hooks.map(async (hook) => {
          const observation = await hook.onRunStart?.(context);
          return observation ?? createNoopObservation<RunLifecycleFinishContext>();
        })
      );
      return mergeObservations(observations);
    },
    async onLLMStageStart(context) {
      const observations = await Promise.all(
        hooks.map(async (hook) => {
          const observation = await hook.onLLMStageStart?.(context);
          return observation ?? createNoopObservation<LLMStageLifecycleFinishContext>();
        })
      );
      return mergeObservations(observations);
    },
    async onToolStageStart(context) {
      const observations = await Promise.all(
        hooks.map(async (hook) => {
          const observation = await hook.onToolStageStart?.(context);
          return observation ?? createNoopObservation<ToolStageLifecycleFinishContext>();
        })
      );
      return mergeObservations(observations);
    },
    async onToolExecutionStart(context) {
      const observations = await Promise.all(
        hooks.map(async (hook) => {
          const observation = await hook.onToolExecutionStart?.(context);
          return observation ?? createNoopObservation<ToolExecutionLifecycleFinishContext>();
        })
      );
      return mergeObservations(observations);
    },
    async onRunError(context) {
      for (const hook of hooks) {
        await hook.onRunError?.(context);
      }
    },
    async onRetryScheduled(context) {
      for (const hook of hooks) {
        await hook.onRetryScheduled?.(context);
      }
    },
  };
}
