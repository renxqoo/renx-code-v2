import {
  Message,
  AgentInput,
  AgentCallbacks,
  AgentContextUsage,
  StreamEvent,
  ErrorDecision,
} from '../types';
import { ToolManager } from '../tool/tool-manager';
import { LLMProvider, Tool, ToolCall } from '../../providers';
import { EventEmitter } from 'events';
import { AgentError, MaxRetriesError, TimeoutBudgetExceededError } from './error';
import { mergeAgentLoggers, type AgentLogger } from './logger';
import { compact, estimateMessagesTokens } from './compaction';
import { LLMTool, ToolConcurrencyPolicy } from '../tool/types';
import type { BackoffConfig } from '../../providers';
import { mergeLLMConfig as mergeLLMRequestConfig } from './message-utils';
import {
  createCheckpoint,
  createDoneEvent,
  createErrorEvent,
  createProgressEvent,
} from './stream-events';
import {
  calculateRetryDelay as calculateRetryDelayWithBackoff,
  isAbortError as isAbortErrorByMessage,
  normalizeError as normalizeAgentError,
} from './error-normalizer';
import {
  createExecutionAbortScope as createExecutionBudgetScope,
  createStageAbortScope as createStageBudgetScope,
  createTimeoutBudgetState as createBudgetState,
  type AbortScope,
  type TimeoutBudgetState,
  type TimeoutStage,
} from './timeout-budget';
import { type WriteBufferRuntime } from './write-file-session';
import { NoopToolExecutionLedger, type ToolExecutionLedger } from './tool-execution-ledger';
import {
  emitMetric as pushMetric,
  emitTrace as pushTrace,
  endSpan as finishSpan,
  extractErrorCode as parseErrorCode,
  logError as writeErrorLog,
  logInfo as writeInfoLog,
  logWarn as writeWarnLog,
  startSpan as beginSpan,
  type SpanRuntime,
} from './telemetry';
import {
  safeCallback as invokeSafeCallback,
  safeErrorCallback as invokeSafeErrorCallback,
} from './callback-safety';
import { generateId } from './shared';
import { processToolCalls as processToolCallsRuntime, type ToolRuntime } from './tool-runtime';
import {
  callLLMAndProcessStream as callLLMStreamRuntime,
  type LLMStreamRuntimeDeps,
} from './llm-stream-runtime';
import { runAgentLoop, type RunLoopRuntime } from './run-loop';
import {
  normalizeTimeoutBudgetError as normalizeAbortTimeoutBudgetError,
  sleepWithAbort,
  throwIfAborted as assertNotAborted,
  timeoutBudgetErrorFromSignal as timeoutErrorFromAbortSignal,
} from './abort-runtime';
import {
  composeAgentRuntimeHooks,
  createNoopObservation,
  type AgentRuntimeLifecycleHooks,
  type LLMStageLifecycleFinishContext,
  type RunLifecycleFinishContext,
  type ToolExecutionLifecycleFinishContext,
  type ToolStageLifecycleFinishContext,
} from './runtime-hooks';

export interface AgentConfig {
  maxRetryCount?: number;
  enableCompaction?: boolean;
  compactionTriggerRatio?: number;
  compactionKeepMessagesNum?: number;
  enableServerSideContinuation?: boolean;
  backoffConfig?: BackoffConfig;
  maxConcurrentToolCalls?: number;
  toolConcurrencyPolicyResolver?: (toolCall: ToolCall) => ToolConcurrencyPolicy;
  logger?: AgentLogger;
  /**
   * Optional external idempotency ledger.
   * Defaults to Noop to keep the agent stateless across process restarts and scale-out replicas.
   */
  toolExecutionLedger?: ToolExecutionLedger;
  timeoutBudgetMs?: number;
  llmTimeoutRatio?: number;
}

export type { AgentLogger } from './logger';

interface InternalAgentConfig {
  maxRetryCount: number;
  enableCompaction: boolean;
  compactionTriggerRatio: number;
  compactionKeepMessagesNum: number;
  enableServerSideContinuation: boolean;
  backoffConfig: BackoffConfig;
  maxConcurrentToolCalls: number;
  toolConcurrencyPolicyResolver?: (toolCall: ToolCall) => ToolConcurrencyPolicy;
  logger: AgentLogger;
  timeoutBudgetMs?: number;
  llmTimeoutRatio: number;
}

const DEFAULT_MAX_RETRY_COUNT = 20;
const DEFAULT_COMPACTION_TRIGGER_RATIO = 0.8;
const DEFAULT_COMPACTION_KEEP_MESSAGES = 20;
const DEFAULT_MAX_CONCURRENT_TOOL_CALLS = 1;
const DEFAULT_LLM_TIMEOUT_RATIO = 0.7;
const ABORTED_MESSAGE = 'Operation aborted';

export type { ToolExecutionLedger, ToolExecutionLedgerRecord } from './tool-execution-ledger';

/**
 * StatelessAgent keeps only per-run ephemeral state in memory.
 *
 * Long-lived concerns such as LLM access, tool execution, telemetry and
 * idempotency are injected from the outside so the same agent instance can be
 * reused safely, and horizontal scale-out does not depend on local process
 * memory for correctness.
 */
export class StatelessAgent extends EventEmitter {
  private llmProvider: LLMProvider;
  private toolExecutor: ToolManager;
  private config: InternalAgentConfig;
  private logger: AgentLogger;
  private toolExecutionLedger: ToolExecutionLedger;
  constructor(llmProvider: LLMProvider, toolExecutor: ToolManager, config: AgentConfig) {
    super();
    this.llmProvider = llmProvider;
    this.toolExecutor = toolExecutor;
    this.logger = config.logger ?? {};
    this.toolExecutionLedger = config.toolExecutionLedger ?? new NoopToolExecutionLedger();
    const llmTimeoutRatio = Number.isFinite(config.llmTimeoutRatio)
      ? Number(config.llmTimeoutRatio)
      : DEFAULT_LLM_TIMEOUT_RATIO;
    const clampedLlmTimeoutRatio = Math.min(0.95, Math.max(0.05, llmTimeoutRatio));
    this.config = {
      maxRetryCount: config.maxRetryCount ?? DEFAULT_MAX_RETRY_COUNT,
      enableCompaction: config.enableCompaction ?? false,
      compactionTriggerRatio: config.compactionTriggerRatio ?? DEFAULT_COMPACTION_TRIGGER_RATIO,
      compactionKeepMessagesNum:
        config.compactionKeepMessagesNum ?? DEFAULT_COMPACTION_KEEP_MESSAGES,
      enableServerSideContinuation: config.enableServerSideContinuation ?? false,
      backoffConfig: config.backoffConfig ?? {},
      maxConcurrentToolCalls: Math.max(
        1,
        Math.floor(config.maxConcurrentToolCalls ?? DEFAULT_MAX_CONCURRENT_TOOL_CALLS)
      ),
      toolConcurrencyPolicyResolver: config.toolConcurrencyPolicyResolver,
      logger: this.logger,
      timeoutBudgetMs:
        config.timeoutBudgetMs &&
        Number.isFinite(config.timeoutBudgetMs) &&
        config.timeoutBudgetMs > 0
          ? Math.floor(config.timeoutBudgetMs)
          : undefined,
      llmTimeoutRatio: clampedLlmTimeoutRatio,
    };
  }

  getContextLimitTokens(contextLimitTokens?: number): number {
    if (
      typeof contextLimitTokens === 'number' &&
      Number.isFinite(contextLimitTokens) &&
      contextLimitTokens > 0
    ) {
      return Math.max(1, Math.floor(contextLimitTokens));
    }
    const maxTokens = this.llmProvider.getLLMMaxTokens();
    const maxOutputTokens = this.llmProvider.getMaxOutputTokens();
    return Math.max(1, maxTokens - maxOutputTokens);
  }

  estimateContextUsage(
    messages: Message[],
    tools?: Tool[],
    contextLimitTokens?: number
  ): Pick<AgentContextUsage, 'contextTokens' | 'contextLimitTokens' | 'contextUsagePercent'> {
    const llmTools = tools as unknown as LLMTool[] | undefined;
    const contextTokens = estimateMessagesTokens(messages, llmTools);
    const resolvedContextLimitTokens = this.getContextLimitTokens(contextLimitTokens);
    return {
      contextTokens,
      contextLimitTokens: resolvedContextLimitTokens,
      contextUsagePercent: (contextTokens / resolvedContextLimitTokens) * 100,
    };
  }

  attachLogger(logger: AgentLogger): void {
    this.logger = mergeAgentLoggers(this.logger, logger);
    this.config.logger = this.logger;
  }

  private needsCompaction(
    messages: Message[],
    tools?: Tool[],
    contextLimitTokens?: number
  ): boolean {
    if (!this.config.enableCompaction) {
      return false;
    }

    const usableLimit = this.getContextLimitTokens(contextLimitTokens);
    const threshold = usableLimit * this.config.compactionTriggerRatio;

    const llmTools = tools as unknown as LLMTool[] | undefined;
    const currentTokens = estimateMessagesTokens(messages, llmTools);

    return currentTokens >= threshold;
  }

  private async compactMessagesIfNeeded(
    messages: Message[],
    tools?: Tool[],
    contextLimitTokens?: number
  ): Promise<string[]> {
    if (!this.needsCompaction(messages, tools, contextLimitTokens)) {
      return [];
    }

    try {
      const result = await compact(messages, {
        provider: this.llmProvider,
        keepMessagesNum: this.config.compactionKeepMessagesNum,
      });
      messages.splice(0, messages.length, ...result.messages);

      return result.removedMessageIds ?? [];
    } catch (error) {
      this.logError('[Agent] Compaction failed:', error);
      return [];
    }
  }

  async *runStream(
    input: AgentInput,
    callbacks?: AgentCallbacks
  ): AsyncGenerator<StreamEvent, void, unknown> {
    const { messages: inputMessages, maxSteps = 100, abortSignal: inputAbortSignal } = input;
    const effectiveTools = this.resolveLLMTools(input.tools);
    const messages = [...inputMessages];
    if (typeof input.systemPrompt === 'string' && input.systemPrompt.trim().length > 0) {
      const hasSystemMessage = messages.some((message) => message.role === 'system');
      if (!hasSystemMessage) {
        messages.unshift({
          messageId: generateId('msg_sys_'),
          type: 'system',
          role: 'system',
          content: input.systemPrompt,
          timestamp: Date.now(),
        });
      }
    }
    const writeBufferSessions = new Map<string, WriteBufferRuntime>();
    const timeoutBudget = this.createTimeoutBudgetState(input);
    const executionScope = this.createExecutionAbortScope(inputAbortSignal, timeoutBudget);
    const abortSignal = executionScope.signal;
    const traceId = input.executionId || generateId('trace_');
    // All lifecycle hooks are composed once per run so stage code can stay
    // focused on orchestration instead of wiring observability concerns.
    const lifecycleHooks = this.createLifecycleHooks();
    const runObservation =
      (await lifecycleHooks.onRunStart?.({
        callbacks,
        traceId,
        executionId: input.executionId,
        conversationId: input.conversationId,
        maxSteps,
        timeoutBudgetMs: timeoutBudget?.totalMs,
      })) ?? createNoopObservation<RunLifecycleFinishContext>();
    return yield* runAgentLoop(this.createRunLoopRuntime(lifecycleHooks), {
      input,
      callbacks,
      maxSteps,
      messages,
      effectiveTools,
      writeBufferSessions,
      timeoutBudget,
      executionScope,
      abortSignal,
      traceId,
      runObservation,
    });
  }

  private async safeCallback<T>(
    callback: ((arg: T) => void | Promise<void>) | undefined,
    arg: T
  ): Promise<void> {
    await invokeSafeCallback(callback, arg, (error) =>
      this.logError('[Agent] Callback error:', error)
    );
  }

  private async safeErrorCallback(
    callback: ((error: Error) => ErrorDecision | void | Promise<ErrorDecision | void>) | undefined,
    error: Error
  ): Promise<ErrorDecision | undefined> {
    return invokeSafeErrorCallback(callback, error, (err) =>
      this.logError('[Agent] Error callback error:', err)
    );
  }

  private createRunLoopRuntime(hooks: AgentRuntimeLifecycleHooks): RunLoopRuntime {
    /**
     * The run loop consumes a grouped runtime instead of a flat dependency bag.
     *
     * Grouping by responsibility makes the contract easier to read, reduces
     * repetitive parameter threading, and gives us a stable seam for future
     * extensions such as alternate hooks or runtime policies without changing
     * the loop algorithm itself.
     */
    return {
      limits: {
        maxRetryCount: this.config.maxRetryCount,
        abortedMessage: ABORTED_MESSAGE,
      },
      callbacks: {
        safe: this.safeCallback.bind(this),
        safeError: this.safeErrorCallback.bind(this),
      },
      messages: {
        compactIfNeeded: this.compactMessagesIfNeeded.bind(this),
        estimateContextUsage: this.estimateContextUsage.bind(this),
        mergeLLMConfig: this.mergeLLMConfig.bind(this),
      },
      stages: {
        llm: (messages, config, abortSignal, executionId, stepIndex, writeBufferSessions) =>
          callLLMStreamRuntime(this.createLLMStreamRuntimeDeps(), {
            messages,
            config,
            abortSignal,
            executionId,
            stepIndex,
            writeBufferSessions,
          }),
        tools: (
          toolCalls,
          messages,
          stepIndex,
          callbacks,
          abortSignal,
          executionId,
          traceId,
          parentSpanId,
          writeBufferSessions
        ) =>
          processToolCallsRuntime(this.createToolRuntime(hooks), {
            toolCalls,
            messages,
            stepIndex,
            callbacks,
            abortSignal,
            executionId,
            traceId,
            parentSpanId,
            writeBufferSessions,
            emitProgress: this.emitProgress.bind(this),
          }),
      },
      stream: {
        progress: this.emitProgress.bind(this),
        checkpoint: this.yieldCheckpoint.bind(this),
        done: this.yieldDoneEvent.bind(this),
        error: this.yieldErrorEvent.bind(this),
        maxRetries: this.yieldMaxRetriesError.bind(this),
      },
      resilience: {
        createStageAbortScope: this.createStageAbortScope.bind(this),
        throwIfAborted: this.throwIfAborted.bind(this),
        normalizeTimeoutBudgetError: this.normalizeTimeoutBudgetError.bind(this),
        timeoutBudgetErrorFromSignal: this.timeoutBudgetErrorFromSignal.bind(this),
        isAbortError: this.isAbortError.bind(this),
        normalizeError: this.normalizeError.bind(this),
        calculateRetryDelay: this.calculateRetryDelay.bind(this),
        sleep: this.sleep.bind(this),
      },
      diagnostics: {
        extractErrorCode: this.extractErrorCode.bind(this),
      },
      hooks,
    };
  }

  private createLLMStreamRuntimeDeps(): LLMStreamRuntimeDeps {
    // Keep the LLM streaming runtime narrowly scoped: it only needs the
    // provider, abort checks and logging. Retry policy stays in the outer run
    // loop so upstream failures and local orchestration failures share one
    // control-flow decision point.
    return {
      llmProvider: this.llmProvider,
      enableServerSideContinuation: this.config.enableServerSideContinuation,
      throwIfAborted: this.throwIfAborted.bind(this),
      logError: this.logError.bind(this),
    };
  }

  private createToolRuntime(hooks?: AgentRuntimeLifecycleHooks): ToolRuntime {
    // Tool execution has its own runtime because it needs a different set of
    // dependencies from the main loop: concurrency, idempotent replay,
    // callback safety and tool-specific telemetry.
    return {
      agentRef: this,
      execution: {
        manager: this.toolExecutor,
        ledger: this.toolExecutionLedger,
        maxConcurrentToolCalls: this.config.maxConcurrentToolCalls,
        resolveConcurrencyPolicy: this.config.toolConcurrencyPolicyResolver,
      },
      callbacks: {
        safe: this.safeCallback.bind(this),
      },
      diagnostics: {
        extractErrorCode: this.extractErrorCode.bind(this),
        logError: this.logError.bind(this),
      },
      resilience: {
        throwIfAborted: this.throwIfAborted.bind(this),
      },
      hooks: hooks ?? this.createLifecycleHooks(),
      events: {
        emit: (eventName, payload) => {
          this.emit(eventName, payload);
        },
      },
    };
  }

  private createLifecycleHooks(): AgentRuntimeLifecycleHooks {
    // Hooks intentionally model lifecycle boundaries instead of internal helper
    // calls. That gives observability and future extension points a stable
    // contract tied to business events rather than implementation details.
    const observabilityHook: AgentRuntimeLifecycleHooks = {
      onRunStart: async (context) => {
        const span = await this.startSpan(
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
        this.logInfo('[Agent] run.start', {
          executionId: context.executionId,
          traceId: context.traceId,
          spanId: span.spanId,
        });
        return {
          spanId: span.spanId,
          startedAt: span.startedAt,
          finish: async (finishContext: RunLifecycleFinishContext) => {
            await this.emitMetric(finishContext.callbacks, {
              name: 'agent.run.duration_ms',
              value: finishContext.latencyMs,
              unit: 'ms',
              timestamp: Date.now(),
              tags: {
                executionId: finishContext.executionId || '',
                outcome: finishContext.outcome,
              },
            });
            await this.emitMetric(finishContext.callbacks, {
              name: 'agent.retry.count',
              value: finishContext.retryCount,
              unit: 'count',
              timestamp: Date.now(),
              tags: {
                executionId: finishContext.executionId || '',
              },
            });
            await this.endSpan(finishContext.callbacks, span, {
              executionId: finishContext.executionId,
              stepIndex: finishContext.stepIndex,
              latencyMs: finishContext.latencyMs,
              outcome: finishContext.outcome,
              errorCode: finishContext.errorCode,
              retryCount: finishContext.retryCount,
            });
            this.logInfo('[Agent] run.finish', {
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
        const span = await this.startSpan(
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
            await this.emitMetric(finishContext.callbacks, {
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
            await this.endSpan(finishContext.callbacks, span, {
              executionId: finishContext.executionId,
              stepIndex: finishContext.stepIndex,
              latencyMs: finishContext.latencyMs,
              errorCode: finishContext.errorCode,
            });
            this.logInfo('[Agent] llm.step', {
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
        const span = await this.startSpan(
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
            await this.emitMetric(finishContext.callbacks, {
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
            await this.endSpan(finishContext.callbacks, span, {
              executionId: finishContext.executionId,
              stepIndex: finishContext.stepIndex,
              latencyMs: finishContext.latencyMs,
              errorCode: finishContext.errorCode,
              toolCalls: finishContext.toolCalls,
            });
            this.logInfo('[Agent] tool.stage', {
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
        const span = await this.startSpan(
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
            await this.emitMetric(finishContext.callbacks, {
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
            await this.endSpan(finishContext.callbacks, span, {
              executionId: finishContext.executionId,
              stepIndex: finishContext.stepIndex,
              toolCallId: finishContext.toolCallId,
              toolName: finishContext.toolName,
              latencyMs: finishContext.latencyMs,
              cached: finishContext.cached,
              errorCode: finishContext.errorCode,
            });
            this.logInfo('[Agent] tool.execute', {
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
        this.logError('[Agent] run.error', context.error, {
          executionId: context.executionId,
          traceId: context.traceId,
          stepIndex: context.stepIndex,
          retryCount: context.retryCount,
          errorCode: context.errorCode,
          category: context.category,
        });
      },
      onRetryScheduled: async (context) => {
        this.logWarn('[Agent] retry.scheduled', {
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

  private async *yieldCheckpoint(
    executionId: string | undefined,
    stepIndex: number,
    lastMessage: Message | undefined,
    callbacks?: AgentCallbacks
  ): AsyncGenerator<StreamEvent, void, unknown> {
    const checkpoint = createCheckpoint(executionId, stepIndex, lastMessage?.messageId);
    await this.safeCallback(callbacks?.onCheckpoint, checkpoint);

    yield {
      type: 'checkpoint',
      data: checkpoint,
    };
  }

  private *yieldMaxRetriesError(): Generator<StreamEvent> {
    yield* this.yieldErrorEvent(new MaxRetriesError());
  }

  private *emitProgress(
    executionId: string | undefined,
    stepIndex: number,
    currentAction: 'llm' | 'tool',
    messageCount: number
  ): Generator<StreamEvent> {
    yield createProgressEvent(executionId, stepIndex, currentAction, messageCount);
  }

  private *yieldErrorEvent(error: AgentError): Generator<StreamEvent> {
    yield createErrorEvent(error);
  }

  private *yieldDoneEvent(
    stepIndex: number,
    finishReason: 'stop' | 'max_steps' = 'stop'
  ): Generator<StreamEvent> {
    yield createDoneEvent(stepIndex, finishReason);
  }

  private mergeLLMConfig(
    config: AgentInput['config'],
    tools?: AgentInput['tools'],
    abortSignal?: AbortSignal,
    conversationId?: string
  ): AgentInput['config'] {
    const merged = mergeLLMRequestConfig(config, tools, abortSignal);
    if (
      typeof conversationId !== 'string' ||
      conversationId.trim().length === 0 ||
      merged?.prompt_cache_key
    ) {
      return merged;
    }

    // Use the conversation id as the default sticky cache routing key so
    // repeated full replays can still hit provider-side prefix caching.
    // This keeps the agent stateless while still improving replay efficiency
    // for providers that support prompt-prefix caching.
    return {
      ...(merged || {}),
      prompt_cache_key: conversationId,
    };
  }

  private resolveLLMTools(inputTools?: Tool[]): Tool[] | undefined {
    // Normalize manager-defined tools into provider-compatible schemas once at
    // the boundary so downstream runtime code only deals with plain Tool[].
    if (typeof inputTools !== 'undefined') {
      return inputTools;
    }

    const manager = this.toolExecutor as ToolManager & {
      getTools?: () => Array<{ toToolSchema?: () => unknown }>;
    };
    if (typeof manager.getTools !== 'function') {
      return undefined;
    }

    const schemas: Tool[] = [];
    for (const tool of manager.getTools()) {
      if (typeof tool.toToolSchema !== 'function') {
        continue;
      }
      const schema = tool.toToolSchema();
      schemas.push({
        type: schema.type,
        function: {
          name: schema.function.name,
          description: schema.function.description,
          parameters: (schema.function.parameters as Record<string, unknown> | undefined) || {},
        },
      });
    }

    return schemas.length > 0 ? schemas : undefined;
  }

  private async emitMetric(
    callbacks: AgentCallbacks | undefined,
    metric: Parameters<typeof pushMetric>[1]
  ): Promise<void> {
    await pushMetric(callbacks, metric, this.safeCallback.bind(this));
  }

  private async emitTrace(
    callbacks: AgentCallbacks | undefined,
    event: Parameters<typeof pushTrace>[1]
  ): Promise<void> {
    await pushTrace(callbacks, event, this.safeCallback.bind(this));
  }

  private async startSpan(
    callbacks: AgentCallbacks | undefined,
    traceId: string,
    name: string,
    parentSpanId?: string,
    attributes?: Record<string, unknown>
  ): Promise<SpanRuntime> {
    return beginSpan({
      callbacks,
      traceId,
      name,
      parentSpanId,
      attributes,
      createSpanId: () => generateId('span_'),
      emitTrace: async (cbs, event) => {
        await this.emitTrace(cbs, event);
      },
    });
  }

  private async endSpan(
    callbacks: AgentCallbacks | undefined,
    span: SpanRuntime,
    attributes?: Record<string, unknown>
  ): Promise<void> {
    await finishSpan({
      callbacks,
      span,
      attributes,
      emitTrace: async (cbs, event) => {
        await this.emitTrace(cbs, event);
      },
    });
  }

  private extractErrorCode(error: unknown): string | undefined {
    return parseErrorCode(error);
  }

  private createTimeoutBudgetState(input: AgentInput): TimeoutBudgetState | undefined {
    // Timeout budgeting is centralized here so every stage derives from the
    // same total budget and ratio rules instead of inventing its own timeout
    // semantics.
    return createBudgetState({
      inputTimeoutBudgetMs: input.timeoutBudgetMs,
      configTimeoutBudgetMs: this.config.timeoutBudgetMs,
      inputLlmTimeoutRatio: input.llmTimeoutRatio,
      configLlmTimeoutRatio: this.config.llmTimeoutRatio,
    });
  }

  private createExecutionAbortScope(
    inputAbortSignal: AbortSignal | undefined,
    timeoutBudget: TimeoutBudgetState | undefined
  ): AbortScope {
    return createExecutionBudgetScope(inputAbortSignal, timeoutBudget);
  }

  private createStageAbortScope(
    baseSignal: AbortSignal | undefined,
    timeoutBudget: TimeoutBudgetState | undefined,
    stage: TimeoutStage
  ): AbortScope {
    return createStageBudgetScope(baseSignal, timeoutBudget, stage);
  }

  private timeoutBudgetErrorFromSignal(
    signal: AbortSignal | undefined
  ): TimeoutBudgetExceededError | undefined {
    return timeoutErrorFromAbortSignal(signal);
  }

  private normalizeTimeoutBudgetError(
    error: unknown,
    signal: AbortSignal | undefined
  ): TimeoutBudgetExceededError | undefined {
    return normalizeAbortTimeoutBudgetError(error, signal);
  }

  private throwIfAborted(signal?: AbortSignal): void {
    assertNotAborted(signal, ABORTED_MESSAGE);
  }

  private isAbortError(error: unknown): boolean {
    return isAbortErrorByMessage(error, ABORTED_MESSAGE);
  }

  private normalizeError(error: unknown): AgentError {
    return normalizeAgentError(error, ABORTED_MESSAGE);
  }

  private calculateRetryDelay(retryCount: number, error: Error): number {
    return calculateRetryDelayWithBackoff(retryCount, error, this.config.backoffConfig);
  }

  private async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    await sleepWithAbort(ms, signal, ABORTED_MESSAGE);
  }

  private logError(message: string, error: unknown, context?: Record<string, unknown>): void {
    writeErrorLog(this.logger, message, error, context);
  }

  private logInfo(message: string, context?: Record<string, unknown>, data?: unknown): void {
    writeInfoLog(this.logger, message, context, data);
  }

  private logWarn(message: string, context?: Record<string, unknown>, data?: unknown): void {
    writeWarnLog(this.logger, message, context, data);
  }
}
