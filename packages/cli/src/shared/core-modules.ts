import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type MessageContentLike = string | Array<Record<string, unknown>>;

export type CoreModules = {
  ProviderRegistry: {
    getModelIds(): string[];
    getModelConfig(modelId: string): {
      id?: string;
      name: string;
      provider?: string;
      envApiKey: string;
      model?: string;
      LLMMAX_TOKENS?: number;
      max_tokens?: number;
    };
    createFromEnv(modelId: string, options?: Record<string, unknown>): unknown;
  };
  buildSystemPrompt(options: Record<string, unknown>): string;
  loadEnvFiles(cwd?: string): Promise<string[]>;
  loadConfigToEnv(options?: Record<string, unknown>): string[];
  loadConfig(options?: Record<string, unknown>): unknown;
  resolveRenxDatabasePath(env?: NodeJS.ProcessEnv): string;
  resolveRenxTaskDir(env?: NodeJS.ProcessEnv): string;
  getProjectConfigPath(projectRoot?: string): string;
  getGlobalConfigPath(): string;
  ensureConfigDirs(projectRoot?: string): void;
  writeProjectConfig(config: Record<string, unknown>, projectRoot?: string): string;
  writeGlobalConfig(config: Record<string, unknown>): string;
  createLoggerFromEnv(env?: NodeJS.ProcessEnv, cwd?: string): unknown;
  createAgentLoggerAdapter(
    logger: Record<string, unknown>,
    baseContext?: Record<string, unknown>
  ): unknown;
  createSqliteAgentAppStore(dbPath: string): {
    prepare?: () => Promise<void>;
    close(): Promise<void>;
    listByConversation?: (
      conversationId: string,
      opts?: { limit?: number; cursor?: string; statuses?: string[] }
    ) => Promise<{ items: Array<Record<string, unknown>>; nextCursor?: string }>;
  };
  AgentAppService: new (deps: {
    agent: unknown;
    executionStore: unknown;
    eventStore: unknown;
    messageStore?: unknown;
    runLogStore?: unknown;
    pendingInputStore?: unknown;
  }) => {
    runForeground(
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
    ): Promise<{
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
    }>;
    getRun?(executionId: string): Promise<Record<string, unknown> | null>;
    listContextMessages(conversationId: string): Promise<Array<Record<string, unknown>>>;
  };
  StatelessAgent: new (
    provider: unknown,
    toolExecutor: {
      getToolSchemas(): Array<{
        type: string;
        function: {
          name?: string;
          description?: string;
          parameters?: Record<string, unknown>;
        };
      }>;
    },
    config: Record<string, unknown>
  ) => {
    on(eventName: 'tool_confirm', listener: (event: Record<string, unknown>) => void): void;
    on(eventName: 'tool_permission', listener: (event: Record<string, unknown>) => void): void;
    off(eventName: 'tool_confirm', listener: (event: Record<string, unknown>) => void): void;
    off(eventName: 'tool_permission', listener: (event: Record<string, unknown>) => void): void;
  };
  createEnterpriseToolSystemV2WithSubagents(options: Record<string, unknown>): unknown;
  EnterpriseToolExecutor: new (options: {
    system: unknown;
    workingDirectory?: string;
    fileSystemPolicy?: unknown;
    networkPolicy?: unknown;
    approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'unless-trusted';
    trustLevel?: 'trusted' | 'untrusted';
  }) => {
    getToolSchemas(): Array<{
      type: string;
      function: {
        name?: string;
        description?: string;
        parameters?: Record<string, unknown>;
      };
    }>;
  };
  createWorkspaceFileSystemPolicy(workspaceRoot: string): unknown;
  createRestrictedNetworkPolicy(): unknown;
  getTaskStateStoreV2(options?: Record<string, unknown>): unknown;
};

let cachedModules: Promise<CoreModules> | null = null;

function isValidCoreModules(modules: Partial<CoreModules>): modules is CoreModules {
  return (
    typeof modules.ProviderRegistry?.getModelIds === 'function' &&
    typeof modules.ProviderRegistry?.getModelConfig === 'function' &&
    typeof modules.createSqliteAgentAppStore === 'function' &&
    typeof modules.AgentAppService === 'function' &&
    typeof modules.StatelessAgent === 'function'
  );
}

async function importCoreFromPackage(): Promise<CoreModules | null> {
  try {
    const imported = (await import('@renx-code/core')) as Partial<CoreModules>;
    return isValidCoreModules(imported) ? imported : null;
  } catch {
    return null;
  }
}

async function importCoreFromDist(repoRoot: string): Promise<CoreModules | null> {
  try {
    const coreEntry = pathToFileURL(
      path.join(repoRoot, 'packages', 'core', 'dist', 'index.js')
    ).href;
    const imported = (await import(coreEntry)) as Partial<CoreModules>;
    return isValidCoreModules(imported) ? imported : null;
  } catch {
    return null;
  }
}

async function importCoreFromSource(repoRoot: string): Promise<CoreModules | null> {
  try {
    const coreEntry = pathToFileURL(
      path.join(repoRoot, 'packages', 'core', 'src', 'index.ts')
    ).href;
    const imported = (await import(coreEntry)) as Partial<CoreModules>;
    return isValidCoreModules(imported) ? imported : null;
  } catch {
    return null;
  }
}

export async function getCoreModules(repoRoot: string): Promise<CoreModules> {
  cachedModules ??= (async () => {
    const fromPackage = await importCoreFromPackage();
    if (fromPackage) {
      return fromPackage;
    }

    const fromDist = await importCoreFromDist(repoRoot);
    if (fromDist) {
      return fromDist;
    }

    const fromSource = await importCoreFromSource(repoRoot);
    if (fromSource) {
      return fromSource;
    }

    throw new Error('Unable to load core modules from package, dist, or source entrypoints.');
  })();

  return cachedModules;
}
