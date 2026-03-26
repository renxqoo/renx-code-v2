import {
  Message,
  AgentInput,
  AgentCallbacks,
  AgentContextUsage,
  StreamEvent,
  ErrorDecision,
} from '../types';
import { LLMProvider, Tool, ToolCall } from '../../providers';
import { EventEmitter } from 'events';
import { AgentError, MaxRetriesError, TimeoutBudgetExceededError } from './error';
import { mergeAgentLoggers, type AgentLogger } from './logger';
import type { BackoffConfig } from '../../providers';
import { mergeLLMRequestConfig } from './llm-request-config';
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
  logDebug as writeDebugLog,
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
import { runAgentLoop, type RunLoopRuntime } from './run-loop';
import {
  normalizeTimeoutBudgetError as normalizeAbortTimeoutBudgetError,
  sleepWithAbort,
  throwIfAborted as assertNotAborted,
  timeoutBudgetErrorFromSignal as timeoutErrorFromAbortSignal,
} from './abort-runtime';
import {
  createNoopObservation,
  type AgentRuntimeLifecycleHooks,
  type RunLifecycleFinishContext,
} from './runtime-hooks';
import {
  createLLMStreamRuntimeDeps as buildLLMStreamRuntimeDeps,
  createRunLoopRuntime as buildRunLoopRuntime,
  createToolRuntime as buildToolRuntime,
  resolveLLMToolsFromExecutor,
} from './runtime-composition';
import { createObservabilityLifecycleHooks } from './observability-hooks';
import { calculateContextUsage } from './compaction-policy';
import type { CompactionPromptVersion } from './compaction-prompt';
import { prepareMessagesForLlmStep } from './step-compaction';
import type { AgentToolExecutor } from './tool-executor';
import type { PrincipalContext } from '../auth/contracts';
import { createSystemPrincipal } from '../auth/principal';
import type { ToolConcurrencyPolicy } from '../tool-v2/contracts';
import { ToolSessionState } from '../tool-v2/context';

export interface AgentConfig {
  maxRetryCount?: number;
  enableCompaction?: boolean;
  compactionTriggerRatio?: number;
  compactionKeepMessagesNum?: number;
  compactionPromptVersion?: CompactionPromptVersion;
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
export type { AgentToolExecutionContext, AgentToolExecutor } from './tool-executor';

interface InternalAgentConfig {
  maxRetryCount: number;
  enableCompaction: boolean;
  compactionTriggerRatio: number;
  compactionKeepMessagesNum: number;
  compactionPromptVersion: CompactionPromptVersion;
  enableServerSideContinuation: boolean;
  backoffConfig: BackoffConfig;
  maxConcurrentToolCalls: number;
  toolConcurrencyPolicyResolver?: (toolCall: ToolCall) => ToolConcurrencyPolicy;
  logger: AgentLogger;
  timeoutBudgetMs?: number;
  llmTimeoutRatio: number;
}

const DEFAULT_MAX_RETRY_COUNT = 20;
const DEFAULT_COMPACTION_TRIGGER_RATIO = 0.92;
const DEFAULT_COMPACTION_KEEP_MESSAGES = 0;
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
  private toolExecutor: AgentToolExecutor;
  private config: InternalAgentConfig;
  private logger: AgentLogger;
  private toolExecutionLedger: ToolExecutionLedger;
  constructor(llmProvider: LLMProvider, toolExecutor: AgentToolExecutor, config: AgentConfig) {
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
      compactionPromptVersion: config.compactionPromptVersion ?? 'v1',
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
    const resolvedContextLimitTokens = this.getContextLimitTokens(contextLimitTokens);
    return calculateContextUsage(messages, tools, resolvedContextLimitTokens);
  }

  attachLogger(logger: AgentLogger): void {
    this.logger = mergeAgentLoggers(this.logger, logger);
    this.config.logger = this.logger;
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
    const toolSessionState = new ToolSessionState();
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
    yield* runAgentLoop(
      this.createRunLoopRuntime(
        lifecycleHooks,
        toolSessionState,
        input.principal || createSystemPrincipal('agent-runtime', 'internal')
      ),
      {
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
      }
    );
    return;
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

  private createRunLoopRuntime(
    hooks: AgentRuntimeLifecycleHooks,
    toolSessionState: ToolSessionState,
    principal: PrincipalContext = createSystemPrincipal('agent-runtime', 'internal')
  ): RunLoopRuntime {
    return buildRunLoopRuntime(
      {
        config: {
          maxRetryCount: this.config.maxRetryCount,
        },
        callbacks: {
          safe: this.safeCallback.bind(this),
          safeError: this.safeErrorCallback.bind(this),
        },
        messages: {
          prepareForLlmStep: (messages, tools, contextLimitTokens) =>
            prepareMessagesForLlmStep(
              messages,
              {
                provider: this.llmProvider,
                logger: this.logger,
                resolveContextLimitTokens: this.getContextLimitTokens.bind(this),
                config: {
                  enableCompaction: this.config.enableCompaction,
                  compactionTriggerRatio: this.config.compactionTriggerRatio,
                  compactionKeepMessagesNum: this.config.compactionKeepMessagesNum,
                  compactionPromptVersion: this.config.compactionPromptVersion,
                },
              },
              {
                tools,
                contextLimitTokens,
              }
            ),
          mergeLLMConfig: mergeLLMRequestConfig,
        },
        createLLMStreamRuntimeDeps: this.createLLMStreamRuntimeDeps.bind(this),
        createToolRuntime: this.createToolRuntime.bind(this),
        toolSessionState,
        principal,
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
        abortedMessage: ABORTED_MESSAGE,
      },
      hooks
    );
  }

  private createLLMStreamRuntimeDeps() {
    return buildLLMStreamRuntimeDeps({
      llmProvider: this.llmProvider,
      enableServerSideContinuation: this.config.enableServerSideContinuation,
      throwIfAborted: this.throwIfAborted.bind(this),
      logDebug: this.logDebug.bind(this),
      logError: this.logError.bind(this),
    });
  }

  private createToolRuntime(
    sessionState: ToolSessionState,
    principal: PrincipalContext,
    hooks?: AgentRuntimeLifecycleHooks
  ) {
    return buildToolRuntime(
      {
        agentRef: this,
        execution: {
          executor: this.toolExecutor,
          principal,
          sessionState,
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
        createLifecycleHooks: this.createLifecycleHooks.bind(this),
        emitEvent: (eventName, payload) => {
          this.emit(eventName, payload);
        },
      },
      hooks
    );
  }

  private createLifecycleHooks(): AgentRuntimeLifecycleHooks {
    return createObservabilityLifecycleHooks({
      startSpan: this.startSpan.bind(this),
      endSpan: this.endSpan.bind(this),
      emitMetric: this.emitMetric.bind(this),
      logInfo: this.logInfo.bind(this),
      logWarn: this.logWarn.bind(this),
      logError: this.logError.bind(this),
    });
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

  private resolveLLMTools(inputTools?: Tool[]): Tool[] | undefined {
    return resolveLLMToolsFromExecutor(this.toolExecutor, inputTools);
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

  private logDebug(message: string, context?: Record<string, unknown>, data?: unknown): void {
    writeDebugLog(this.logger, message, context, data);
  }

  private logWarn(message: string, context?: Record<string, unknown>, data?: unknown): void {
    writeWarnLog(this.logger, message, context, data);
  }
}
