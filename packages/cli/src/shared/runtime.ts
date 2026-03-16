import type { CoreModules, MessageContentLike } from './core-modules.js';
import { getCoreModules } from './core-modules.js';
import { CliUsageError } from './errors.js';

type ToolSchema = {
  type: string;
  function: {
    name?: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

type AgentLike = {
  on(eventName: 'tool_confirm', listener: (event: Record<string, unknown>) => void): void;
  on(eventName: 'tool_permission', listener: (event: Record<string, unknown>) => void): void;
  off(eventName: 'tool_confirm', listener: (event: Record<string, unknown>) => void): void;
  off(eventName: 'tool_permission', listener: (event: Record<string, unknown>) => void): void;
};

type RunResult = {
  executionId: string;
  conversationId: string;
  finishReason: 'stop' | 'max_steps' | 'error';
  steps: number;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: MessageContentLike;
    messageId: string;
    timestamp: number;
  }>;
  run: {
    status?: string;
    terminalReason?: string;
    errorMessage?: string;
  };
};

export type PromptExecutionResult = {
  run: RunResult;
  assistantText: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cumulativePromptTokens: number;
    cumulativeCompletionTokens: number;
    cumulativeTotalTokens: number;
    contextTokens?: number;
    contextLimitTokens?: number;
    contextUsagePercent?: number;
  };
  contextUsage?: {
    stepIndex: number;
    messageCount: number;
    contextTokens: number;
    contextLimitTokens: number;
    contextUsagePercent: number;
  };
};

export type SharedRuntime = {
  modules: CoreModules;
  repoRoot: string;
  cwd: string;
  workspaceRoot: string;
  modelId: string;
  modelLabel: string;
  conversationId: string;
  maxSteps: number;
  toolSchemas: ToolSchema[];
  agent: AgentLike;
  appService: {
    runForeground: (
      request: {
        executionId?: string;
        conversationId: string;
        userInput: MessageContentLike;
        historyMessages?: Array<Record<string, unknown>>;
        systemPrompt?: string;
        tools?: Array<{ type: string; function: Record<string, unknown> }>;
        config?: Record<string, unknown>;
        maxSteps?: number;
        abortSignal?: AbortSignal;
        modelLabel?: string;
      },
      callbacks?: {
        onUsage?: (usage: Record<string, unknown>) => void | Promise<void>;
        onContextUsage?: (usage: Record<string, unknown>) => void | Promise<void>;
      }
    ) => Promise<RunResult>;
    getRun?: (executionId: string) => Promise<Record<string, unknown> | null>;
    listContextMessages: (conversationId: string) => Promise<Array<Record<string, unknown>>>;
  };
  appStore: {
    close: () => Promise<void>;
    listByConversation?: (
      conversationId: string,
      opts?: { limit?: number; cursor?: string; statuses?: string[] }
    ) => Promise<{ items: Array<Record<string, unknown>>; nextCursor?: string }>;
    client?: {
      all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
      get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
    };
  };
  dispose: () => Promise<void>;
};

const DEFAULT_MODEL_ID = 'qwen3.5-plus';
const DEFAULT_MAX_STEPS = 10000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function createExecutionId(): string {
  return `exec_cli_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveConversationId(explicit?: string): string {
  const envId = process.env.AGENT_CONVERSATION_ID?.trim() || process.env.AGENT_SESSION_ID?.trim();
  return explicit?.trim() || envId || `cli-${Date.now()}`;
}

function resolveModelId(modules: CoreModules, requested?: string): string {
  const available = modules.ProviderRegistry.getModelIds();
  const normalized = requested?.trim();
  if (normalized && available.includes(normalized)) {
    return normalized;
  }
  if (available.includes(DEFAULT_MODEL_ID)) {
    return DEFAULT_MODEL_ID;
  }
  const fallback = available[0];
  if (!fallback) {
    throw new CliUsageError('No models are registered in ProviderRegistry.');
  }
  return fallback;
}

function filterToolSchemas(schemas: ToolSchema[]): ToolSchema[] {
  const hidden = new Set(['file_history_list', 'file_history_restore']);
  return schemas.filter((schema) => {
    const name = schema.function?.name;
    return typeof name === 'string' && !hidden.has(name);
  });
}

function normalizeTools(schemas: ToolSchema[]): Array<{ type: string; function: Record<string, unknown> }> {
  return schemas.map((schema) => ({
    type: schema.type,
    function: {
      name: schema.function?.name || 'unknown',
      description: schema.function?.description || '',
      parameters: schema.function?.parameters || { type: 'object', properties: {} },
    },
  }));
}

function buildPromptCacheConfig(conversationId: string): Record<string, unknown> | undefined {
  const key = process.env.AGENT_PROMPT_CACHE_KEY?.trim()?.replace(/\{conversationId\}/g, conversationId);
  const retention = process.env.AGENT_PROMPT_CACHE_RETENTION?.trim();
  const config: Record<string, unknown> = {};
  if (key) {
    config.prompt_cache_key = key;
  }
  if (retention) {
    config.prompt_cache_retention = retention;
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

function extractAssistantText(run: RunResult): string {
  for (let i = run.messages.length - 1; i >= 0; i -= 1) {
    const message = run.messages[i];
    if (message?.role !== 'assistant') {
      continue;
    }
    if (typeof message.content === 'string') {
      return message.content;
    }
    return JSON.stringify(message.content);
  }
  return '';
}

function readUsagePayload(usage: Record<string, unknown>): PromptExecutionResult['usage'] | undefined {
  const stepUsage = usage.usage as Record<string, unknown> | undefined;
  const cumulativeUsage = usage.cumulativeUsage as Record<string, unknown> | undefined;
  if (!stepUsage || !cumulativeUsage) {
    return undefined;
  }

  const promptTokens = Number(stepUsage.prompt_tokens);
  const completionTokens = Number(stepUsage.completion_tokens);
  const totalTokens = Number(stepUsage.total_tokens);
  const cumulativePromptTokens = Number(cumulativeUsage.prompt_tokens);
  const cumulativeCompletionTokens = Number(cumulativeUsage.completion_tokens);
  const cumulativeTotalTokens = Number(cumulativeUsage.total_tokens);

  if (
    !Number.isFinite(promptTokens) ||
    !Number.isFinite(completionTokens) ||
    !Number.isFinite(totalTokens) ||
    !Number.isFinite(cumulativePromptTokens) ||
    !Number.isFinite(cumulativeCompletionTokens) ||
    !Number.isFinite(cumulativeTotalTokens)
  ) {
    return undefined;
  }

  const contextTokens = Number(usage.contextTokens);
  const contextLimitTokens = Number(usage.contextLimitTokens);
  const contextUsagePercent = Number(usage.contextUsagePercent);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cumulativePromptTokens,
    cumulativeCompletionTokens,
    cumulativeTotalTokens,
    ...(Number.isFinite(contextTokens) ? { contextTokens } : {}),
    ...(Number.isFinite(contextLimitTokens) ? { contextLimitTokens } : {}),
    ...(Number.isFinite(contextUsagePercent) ? { contextUsagePercent } : {}),
  };
}

function readContextUsagePayload(payload: Record<string, unknown>): PromptExecutionResult['contextUsage'] | undefined {
  const stepIndex = Number(payload.stepIndex);
  const messageCount = Number(payload.messageCount);
  const contextTokens = Number(payload.contextTokens);
  const contextLimitTokens = Number(payload.contextLimitTokens);
  const contextUsagePercent = Number(payload.contextUsagePercent);

  if (
    !Number.isFinite(stepIndex) ||
    !Number.isFinite(messageCount) ||
    !Number.isFinite(contextTokens) ||
    !Number.isFinite(contextLimitTokens) ||
    !Number.isFinite(contextUsagePercent)
  ) {
    return undefined;
  }

  return {
    stepIndex,
    messageCount,
    contextTokens,
    contextLimitTokens,
    contextUsagePercent,
  };
}

export async function createSharedRuntime(options: {
  repoRoot: string;
  cwd: string;
  modelId?: string;
  maxSteps?: number;
  conversationId?: string;
}): Promise<SharedRuntime> {
  const modules = await getCoreModules(options.repoRoot);

  await modules.loadEnvFiles(options.cwd);
  modules.loadConfigToEnv({ projectRoot: options.cwd });

  const selectedModel = resolveModelId(modules, options.modelId || process.env.AGENT_MODEL);
  const modelConfig = modules.ProviderRegistry.getModelConfig(selectedModel);

  if (!process.env[modelConfig.envApiKey]) {
    throw new CliUsageError(`Missing env ${modelConfig.envApiKey} for model ${selectedModel}.`);
  }

  const workspaceRoot = options.cwd;
  const conversationId = resolveConversationId(options.conversationId);
  const maxSteps = options.maxSteps ?? parsePositiveInt(process.env.AGENT_MAX_STEPS, DEFAULT_MAX_STEPS);

  const coreLogger = modules.createLoggerFromEnv(
    {
      ...process.env,
      AGENT_LOG_CONSOLE: 'false',
    },
    workspaceRoot
  );

  const loggerRecord =
    coreLogger && typeof coreLogger === 'object' ? (coreLogger as Record<string, unknown>) : {};
  const agentLogger = modules.createAgentLoggerAdapter(loggerRecord, {
    runtime: 'renx-cli',
  });

  const provider = modules.ProviderRegistry.createFromEnv(selectedModel, {
    logger: loggerRecord,
  });

  const appStore = modules.createSqliteAgentAppStore(modules.resolveRenxDatabasePath(process.env));
  if (typeof appStore.prepare === 'function') {
    await appStore.prepare();
  }

  let boundAppService:
    | {
        runForeground: SharedRuntime['appService']['runForeground'];
        getRun?: (executionId: string) => Promise<Record<string, unknown> | null>;
        listContextMessages: SharedRuntime['appService']['listContextMessages'];
      }
    | null = null;

  const deferredAppService = {
    runForeground: (...args: Parameters<SharedRuntime['appService']['runForeground']>) => {
      if (!boundAppService) {
        throw new Error('CLI_SUBAGENT_APP_SERVICE_NOT_READY');
      }
      return boundAppService.runForeground(...args);
    },
    getRun: async (executionId: string) => {
      if (!boundAppService?.getRun) {
        return null;
      }
      return boundAppService.getRun(executionId);
    },
    listContextMessages: (...args: Parameters<SharedRuntime['appService']['listContextMessages']>) => {
      if (!boundAppService) {
        throw new Error('CLI_SUBAGENT_APP_SERVICE_NOT_READY');
      }
      return boundAppService.listContextMessages(...args);
    },
  };

  let executorRef:
    | {
        getToolSchemas(): ToolSchema[];
      }
    | null = null;

  const toolSystem = modules.createEnterpriseToolSystemV2WithSubagents({
    appService: deferredAppService,
    resolveTools: (allowedTools?: string[]) => {
      const schemas = filterToolSchemas(executorRef?.getToolSchemas() || []);
      if (!allowedTools || allowedTools.length === 0) {
        return schemas;
      }
      const allowed = new Set(allowedTools);
      return schemas.filter((schema) => {
        const name = schema.function?.name;
        return typeof name === 'string' && allowed.has(name);
      });
    },
    resolveModelId: () => modelConfig.model || selectedModel,
    builtIns: {
      skill: {
        loaderOptions: {
          workingDir: workspaceRoot,
        },
      },
      task: {
        store: modules.getTaskStateStoreV2({
          baseDir: modules.resolveRenxTaskDir(process.env),
        }),
        defaultNamespace: conversationId,
      },
    },
  });

  const toolExecutor = new modules.EnterpriseToolExecutor({
    system: toolSystem,
    workingDirectory: workspaceRoot,
    fileSystemPolicy: modules.createWorkspaceFileSystemPolicy(workspaceRoot),
    networkPolicy: modules.createRestrictedNetworkPolicy(),
    approvalPolicy: 'on-request',
    trustLevel: 'untrusted',
  });

  executorRef = toolExecutor;

  const agent = new modules.StatelessAgent(provider, toolExecutor, {
    maxRetryCount: parsePositiveInt(process.env.AGENT_MAX_RETRY_COUNT, 10),
    enableCompaction: true,
    logger: agentLogger,
  });

  const appService = new modules.AgentAppService({
    agent,
    executionStore: appStore,
    eventStore: appStore,
    messageStore: appStore,
  }) as SharedRuntime['appService'];

  boundAppService = {
    runForeground: appService.runForeground,
    getRun: appService.getRun,
    listContextMessages: appService.listContextMessages,
  };

  return {
    modules,
    repoRoot: options.repoRoot,
    cwd: options.cwd,
    workspaceRoot,
    modelId: selectedModel,
    modelLabel: modelConfig.name,
    conversationId,
    maxSteps,
    toolSchemas: filterToolSchemas(toolExecutor.getToolSchemas()),
    agent,
    appService,
    appStore,
    dispose: async () => {
      const close = (coreLogger as { close?: () => void | Promise<void> } | undefined)?.close;
      if (typeof close === 'function') {
        await close();
      }
      await appStore.close();
    },
  };
}

export async function runPromptOnce(
  runtime: SharedRuntime,
  prompt: MessageContentLike,
  options: {
    conversationId?: string;
    maxSteps?: number;
    abortSignal?: AbortSignal;
    autoApproveTools?: boolean;
    autoGrantRequestedPermissions?: boolean;
  } = {}
): Promise<PromptExecutionResult> {
  const conversationId = resolveConversationId(options.conversationId || runtime.conversationId);
  const executionId = createExecutionId();
  const historyMessages = await runtime.appService.listContextMessages(conversationId);

  let latestUsage: PromptExecutionResult['usage'];
  let latestContextUsage: PromptExecutionResult['contextUsage'];

  const onToolConfirm = (event: Record<string, unknown>) => {
    const resolve = event.resolve;
    if (typeof resolve === 'function') {
      resolve({
        approved: options.autoApproveTools !== false,
        message: options.autoApproveTools === false ? 'Denied by non-interactive CLI policy.' : undefined,
      });
    }
  };

  const onToolPermission = (event: Record<string, unknown>) => {
    const resolve = event.resolve;
    if (typeof resolve === 'function') {
      const requestedScope = event.requestedScope === 'session' ? 'session' : 'turn';
      resolve({
        granted:
          options.autoGrantRequestedPermissions === true &&
          event.permissions &&
          typeof event.permissions === 'object'
            ? event.permissions
            : {},
        scope: requestedScope,
      });
    }
  };

  runtime.agent.on('tool_confirm', onToolConfirm);
  runtime.agent.on('tool_permission', onToolPermission);

  try {
    const run = await runtime.appService.runForeground(
      {
        executionId,
        conversationId,
        userInput: prompt,
        historyMessages,
        systemPrompt: runtime.modules.buildSystemPrompt({
          directory: runtime.workspaceRoot,
          runtimeToolNames: runtime.toolSchemas
            .map((tool) => tool.function?.name)
            .filter((name): name is string => typeof name === 'string'),
        }),
        tools: normalizeTools(runtime.toolSchemas),
        config: buildPromptCacheConfig(conversationId),
        maxSteps: options.maxSteps ?? runtime.maxSteps,
        abortSignal: options.abortSignal,
        modelLabel: runtime.modelLabel,
      },
      {
        onUsage: (payload) => {
          if (payload && typeof payload === 'object') {
            latestUsage = readUsagePayload(payload);
          }
        },
        onContextUsage: (payload) => {
          if (payload && typeof payload === 'object') {
            latestContextUsage = readContextUsagePayload(payload);
          }
        },
      }
    );

    return {
      run,
      assistantText: extractAssistantText(run),
      usage: latestUsage,
      contextUsage: latestContextUsage,
    };
  } finally {
    runtime.agent.off('tool_confirm', onToolConfirm);
    runtime.agent.off('tool_permission', onToolPermission);
  }
}
