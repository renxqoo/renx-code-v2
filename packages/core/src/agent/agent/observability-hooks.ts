import type { AgentCallbacks } from '../types';

import type { SpanRuntime } from './telemetry';
import {
  composeAgentRuntimeHooks,
  type AgentRuntimeLifecycleHooks,
  type LLMStageLifecycleFinishContext,
  type RunLifecycleFinishContext,
  type ToolExecutionLifecycleFinishContext,
  type ToolStageLifecycleFinishContext,
} from './runtime-hooks';

interface MetricInput {
  name: string;
  value: number;
  unit?: 'ms' | 'count';
  timestamp: number;
  tags?: Record<string, string | number | boolean>;
}

export interface ObservabilityLifecycleHookDeps {
  startSpan: (
    callbacks: AgentCallbacks | undefined,
    traceId: string,
    name: string,
    parentSpanId?: string,
    attributes?: Record<string, unknown>
  ) => Promise<SpanRuntime>;
  endSpan: (
    callbacks: AgentCallbacks | undefined,
    span: SpanRuntime,
    attributes?: Record<string, unknown>
  ) => Promise<void>;
  emitMetric: (callbacks: AgentCallbacks | undefined, metric: MetricInput) => Promise<void>;
  logInfo: (message: string, context?: Record<string, unknown>, data?: unknown) => void;
  logWarn: (message: string, context?: Record<string, unknown>, data?: unknown) => void;
  logError: (message: string, error: unknown, context?: Record<string, unknown>) => void;
}

/**
 * Build the default lifecycle hooks used by the stateless kernel.
 *
 * These hooks are intentionally observational: they create spans, emit metrics
 * and write structured logs, but they do not alter control-flow decisions.
 * That keeps the runtime deterministic while still giving outer layers a clean
 * place to attach auditing and telemetry behavior.
 */
export function createObservabilityLifecycleHooks(
  deps: ObservabilityLifecycleHookDeps
): AgentRuntimeLifecycleHooks {
  const observabilityHook: AgentRuntimeLifecycleHooks = {
    onRunStart: async (context) => {
      const span = await deps.startSpan(
        context.callbacks,
        context.traceId,
        'agent.run',
        undefined,
        {
          executionId: context.executionId,
          conversationId: context.conversationId,
          maxSteps: context.maxSteps,
          timeoutBudgetMs: context.timeoutBudgetMs,
        }
      );
      deps.logInfo('[Agent] run.start', {
        executionId: context.executionId,
        traceId: context.traceId,
        spanId: span.spanId,
      });
      return {
        spanId: span.spanId,
        startedAt: span.startedAt,
        finish: async (finishContext: RunLifecycleFinishContext) => {
          await deps.emitMetric(finishContext.callbacks, {
            name: 'agent.run.duration_ms',
            value: finishContext.latencyMs,
            unit: 'ms',
            timestamp: Date.now(),
            tags: {
              executionId: finishContext.executionId || '',
              outcome: finishContext.outcome,
            },
          });
          await deps.emitMetric(finishContext.callbacks, {
            name: 'agent.retry.count',
            value: finishContext.retryCount,
            unit: 'count',
            timestamp: Date.now(),
            tags: {
              executionId: finishContext.executionId || '',
            },
          });
          await deps.endSpan(finishContext.callbacks, span, {
            executionId: finishContext.executionId,
            stepIndex: finishContext.stepIndex,
            latencyMs: finishContext.latencyMs,
            outcome: finishContext.outcome,
            errorCode: finishContext.errorCode,
            retryCount: finishContext.retryCount,
          });
          deps.logInfo('[Agent] run.finish', {
            executionId: finishContext.executionId,
            traceId: finishContext.traceId,
            spanId: span.spanId,
            stepIndex: finishContext.stepIndex,
            latencyMs: finishContext.latencyMs,
            outcome: finishContext.outcome,
            errorCode: finishContext.errorCode,
            retryCount: finishContext.retryCount,
          });
        },
      };
    },
    onLLMStageStart: async (context) => {
      const span = await deps.startSpan(
        context.callbacks,
        context.traceId,
        'agent.llm.step',
        context.parentSpanId,
        {
          executionId: context.executionId,
          stepIndex: context.stepIndex,
          messageCount: context.messageCount,
        }
      );
      return {
        spanId: span.spanId,
        startedAt: span.startedAt,
        finish: async (finishContext: LLMStageLifecycleFinishContext) => {
          await deps.emitMetric(finishContext.callbacks, {
            name: 'agent.llm.duration_ms',
            value: finishContext.latencyMs,
            unit: 'ms',
            timestamp: Date.now(),
            tags: {
              executionId: finishContext.executionId || '',
              stepIndex: finishContext.stepIndex,
              success: finishContext.success ? 'true' : 'false',
            },
          });
          await deps.endSpan(finishContext.callbacks, span, {
            executionId: finishContext.executionId,
            stepIndex: finishContext.stepIndex,
            latencyMs: finishContext.latencyMs,
            errorCode: finishContext.errorCode,
          });
          deps.logInfo('[Agent] llm.step', {
            executionId: finishContext.executionId,
            traceId: finishContext.traceId,
            spanId: span.spanId,
            stepIndex: finishContext.stepIndex,
            latencyMs: finishContext.latencyMs,
            errorCode: finishContext.errorCode,
            messageCount: finishContext.messageCount,
          });
        },
      };
    },
    onToolStageStart: async (context) => {
      const span = await deps.startSpan(
        context.callbacks,
        context.traceId,
        'agent.tool.stage',
        context.parentSpanId,
        {
          executionId: context.executionId,
          stepIndex: context.stepIndex,
          toolCalls: context.toolCalls,
        }
      );
      return {
        spanId: span.spanId,
        startedAt: span.startedAt,
        finish: async (finishContext: ToolStageLifecycleFinishContext) => {
          await deps.emitMetric(finishContext.callbacks, {
            name: 'agent.tool.stage.duration_ms',
            value: finishContext.latencyMs,
            unit: 'ms',
            timestamp: Date.now(),
            tags: {
              executionId: finishContext.executionId || '',
              stepIndex: finishContext.stepIndex,
              success: finishContext.success ? 'true' : 'false',
            },
          });
          await deps.endSpan(finishContext.callbacks, span, {
            executionId: finishContext.executionId,
            stepIndex: finishContext.stepIndex,
            latencyMs: finishContext.latencyMs,
            errorCode: finishContext.errorCode,
            toolCalls: finishContext.toolCalls,
          });
          deps.logInfo('[Agent] tool.stage', {
            executionId: finishContext.executionId,
            traceId: finishContext.traceId,
            spanId: span.spanId,
            stepIndex: finishContext.stepIndex,
            latencyMs: finishContext.latencyMs,
            errorCode: finishContext.errorCode,
            toolCalls: finishContext.toolCalls,
          });
        },
      };
    },
    onToolExecutionStart: async (context) => {
      const span = await deps.startSpan(
        context.callbacks,
        context.traceId,
        'agent.tool.execute',
        context.parentSpanId,
        {
          executionId: context.executionId,
          stepIndex: context.stepIndex,
          toolCallId: context.toolCallId,
          toolName: context.toolName,
        }
      );
      return {
        spanId: span.spanId,
        startedAt: span.startedAt,
        finish: async (finishContext: ToolExecutionLifecycleFinishContext) => {
          await deps.emitMetric(finishContext.callbacks, {
            name: 'agent.tool.duration_ms',
            value: finishContext.latencyMs,
            unit: 'ms',
            timestamp: Date.now(),
            tags: {
              executionId: finishContext.executionId || '',
              stepIndex: String(finishContext.stepIndex),
              toolCallId: finishContext.toolCallId,
              cached: finishContext.cached ? 'true' : 'false',
              success: finishContext.success ? 'true' : 'false',
            },
          });
          await deps.endSpan(finishContext.callbacks, span, {
            executionId: finishContext.executionId,
            stepIndex: finishContext.stepIndex,
            toolCallId: finishContext.toolCallId,
            toolName: finishContext.toolName,
            latencyMs: finishContext.latencyMs,
            cached: finishContext.cached,
            errorCode: finishContext.errorCode,
          });
          deps.logInfo('[Agent] tool.execute', {
            executionId: finishContext.executionId,
            traceId: finishContext.traceId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            stepIndex: finishContext.stepIndex,
            toolCallId: finishContext.toolCallId,
            toolName: finishContext.toolName,
            latencyMs: finishContext.latencyMs,
            cached: finishContext.cached,
            errorCode: finishContext.errorCode,
          });
        },
      };
    },
    onRunError: async (context) => {
      deps.logError('[Agent] run.error', context.error, {
        executionId: context.executionId,
        traceId: context.traceId,
        stepIndex: context.stepIndex,
        retryCount: context.retryCount,
        errorCode: context.errorCode,
        category: context.category,
      });
    },
    onRetryScheduled: async (context) => {
      deps.logWarn('[Agent] retry.scheduled', {
        executionId: context.executionId,
        traceId: context.traceId,
        stepIndex: context.stepIndex,
        retryCount: context.retryCount,
        errorCode: context.errorCode,
      });
    },
  };

  return composeAgentRuntimeHooks([observabilityHook]);
}
