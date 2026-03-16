import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./tool-confirmation', () => ({
  resolveToolConfirmDecision: vi.fn().mockResolvedValue({ approved: true, message: 'Approved' }),
  resolveToolPermissionGrant: vi.fn().mockResolvedValue({
    granted: {
      fileSystem: {
        read: ['/tmp/project'],
      },
    },
    scope: 'turn',
  }),
}));

vi.mock('./source-modules', () => ({
  getSourceModules: vi.fn(),
  resolveWorkspaceRoot: vi.fn(),
}));

import {
  appendAgentPrompt,
  disposeAgentRuntime,
  getAgentModelId,
  getAgentModelLabel,
  listAgentModels,
  runAgentPrompt,
  switchAgentModel,
} from './runtime';
import * as sourceModules from './source-modules';
import type { AgentEventHandlers } from './types';
import type { ToolSchemaLike } from './source-modules';

const buildMockModules = (
  overrides?: Partial<Awaited<ReturnType<typeof sourceModules.getSourceModules>>>
) => {
  const renxHome = process.env.RENX_HOME || path.join(process.cwd(), '.tmp-renx-home');
  const schemas: ToolSchemaLike[] = [
    { type: 'function', function: { name: 'local_shell' } },
    { type: 'function', function: { name: 'write_file' } },
    { type: 'function', function: { name: 'read_file' } },
    { type: 'function', function: { name: 'file_edit' } },
    { type: 'function', function: { name: 'file_history_list' } },
    { type: 'function', function: { name: 'file_history_restore' } },
    { type: 'function', function: { name: 'glob' } },
    { type: 'function', function: { name: 'grep' } },
    { type: 'function', function: { name: 'skill' } },
    { type: 'function', function: { name: 'spawn_agent' } },
    { type: 'function', function: { name: 'agent_status' } },
    { type: 'function', function: { name: 'wait_agents' } },
    { type: 'function', function: { name: 'cancel_agent' } },
    { type: 'function', function: { name: 'task_create' } },
    { type: 'function', function: { name: 'task_get' } },
    { type: 'function', function: { name: 'task_list' } },
    { type: 'function', function: { name: 'task_update' } },
    { type: 'function', function: { name: 'task_stop' } },
    { type: 'function', function: { name: 'task_output' } },
  ];

  class FakeToolExecutor {
    private readonly schemas: ToolSchemaLike[];

    constructor(options: { system?: { schemas?: ToolSchemaLike[] } }) {
      this.schemas = options.system?.schemas || [];
    }

    getToolSchemas = vi.fn(() => this.schemas);
  }

  class FakeAgent {
    on = vi.fn();
    off = vi.fn();
  }

  class FakeAppService {
    static lastRequest: unknown;
    static appendResult = { accepted: true };
    static appendRequests: unknown[] = [];

    async listContextMessages() {
      return [];
    }

    async getRun() {
      return null;
    }

    async runForeground(request: unknown) {
      FakeAppService.lastRequest = request;
      return {
        executionId: 'exec_runtime',
        conversationId: 'conv_runtime',
        messages: [
          {
            messageId: 'msg_assistant',
            role: 'assistant' as const,
            type: 'assistant-text' as const,
            content: 'done',
            timestamp: Date.now(),
          },
        ],
        events: [],
        finishReason: 'stop' as const,
        steps: 1,
        run: {
          executionId: 'exec_runtime',
          runId: 'exec_runtime',
          conversationId: 'conv_runtime',
          status: 'COMPLETED' as const,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          stepIndex: 1,
        },
      };
    }

    async appendUserInputToRun(request: unknown) {
      FakeAppService.appendRequests.push(request);
      return FakeAppService.appendResult;
    }
  }

  class FakeAppStore {
    static lastDbPath: string | undefined;

    constructor(dbPath: string) {
      FakeAppStore.lastDbPath = dbPath;
    }

    close = vi.fn().mockResolvedValue(undefined);
  }

  return {
    ProviderRegistry: {
      getModelIds: () => ['glm-5', 'claude-3.5-sonnet'],
      getModelConfig: (modelId: string) => ({
        name: modelId === 'glm-5' ? 'GLM-5' : 'Claude 3.5 Sonnet',
        envApiKey: 'TEST_API_KEY',
        provider: modelId === 'glm-5' ? 'zhipu' : 'anthropic',
        model: modelId,
      }),
      createFromEnv: () => ({}),
    },
    buildSystemPrompt: vi.fn(() => 'Test system prompt'),
    loadEnvFiles: vi.fn().mockResolvedValue([]),
    loadConfigToEnv: vi.fn().mockReturnValue([]),
    resolveRenxDatabasePath: vi.fn(() => path.join(renxHome, 'data.db')),
    resolveRenxTaskDir: vi.fn(() => path.join(renxHome, 'task')),
    createLoggerFromEnv: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
    createAgentLoggerAdapter: vi.fn((logger: Record<string, unknown>) => ({
      info: typeof logger.info === 'function' ? logger.info.bind(logger) : undefined,
      warn: typeof logger.warn === 'function' ? logger.warn.bind(logger) : undefined,
      error: typeof logger.error === 'function' ? logger.error.bind(logger) : undefined,
    })),
    StatelessAgent: FakeAgent,
    AgentAppService: FakeAppService,
    createSqliteAgentAppStore: (dbPath: string) => new FakeAppStore(dbPath),
    createEnterpriseToolSystemV2WithSubagents: vi.fn(() => ({
      schemas,
    })),
    EnterpriseToolExecutor: FakeToolExecutor,
    createWorkspaceFileSystemPolicy: vi.fn(() => ({ mode: 'restricted' })),
    createRestrictedNetworkPolicy: vi.fn(() => ({ mode: 'restricted' })),
    getTaskStateStoreV2: vi.fn(() => ({})),
    ...overrides,
  };
};

describe('runtime', () => {
  const mockGetSourceModules = sourceModules.getSourceModules as unknown as ReturnType<
    typeof vi.fn
  >;
  const mockResolveWorkspaceRoot = sourceModules.resolveWorkspaceRoot as unknown as ReturnType<
    typeof vi.fn
  >;
  const originalApiKey = process.env.TEST_API_KEY;
  const originalRenxHome = process.env.RENX_HOME;
  const originalAgentModel = process.env.AGENT_MODEL;
  const originalPromptCacheKey = process.env.AGENT_PROMPT_CACHE_KEY;
  const originalPromptCacheRetention = process.env.AGENT_PROMPT_CACHE_RETENTION;
  const renxHome = path.join(process.cwd(), '.tmp-renx-home');

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEST_API_KEY = 'test-key';
    process.env.RENX_HOME = renxHome;
    delete process.env.AGENT_MODEL;
    delete process.env.AGENT_PROMPT_CACHE_KEY;
    delete process.env.AGENT_PROMPT_CACHE_RETENTION;
    mockResolveWorkspaceRoot.mockReturnValue('/test/workspace');
    mockGetSourceModules.mockResolvedValue(buildMockModules());
  });

  afterEach(async () => {
    await disposeAgentRuntime();
    if (originalApiKey === undefined) {
      delete process.env.TEST_API_KEY;
    } else {
      process.env.TEST_API_KEY = originalApiKey;
    }
    if (originalRenxHome === undefined) {
      delete process.env.RENX_HOME;
    } else {
      process.env.RENX_HOME = originalRenxHome;
    }
    if (originalAgentModel === undefined) {
      delete process.env.AGENT_MODEL;
    } else {
      process.env.AGENT_MODEL = originalAgentModel;
    }
    if (originalPromptCacheKey === undefined) {
      delete process.env.AGENT_PROMPT_CACHE_KEY;
    } else {
      process.env.AGENT_PROMPT_CACHE_KEY = originalPromptCacheKey;
    }
    if (originalPromptCacheRetention === undefined) {
      delete process.env.AGENT_PROMPT_CACHE_RETENTION;
    } else {
      process.env.AGENT_PROMPT_CACHE_RETENTION = originalPromptCacheRetention;
    }
  });

  it('returns the active model label', async () => {
    await expect(getAgentModelLabel()).resolves.toBe('GLM-5');
  });

  it('returns the active model id', async () => {
    await expect(getAgentModelId()).resolves.toBe('glm-5');
  });

  it('uses AGENT_MODEL loaded from config before runtime initialization', async () => {
    const modules = buildMockModules({
      ProviderRegistry: {
        getModelIds: () => ['glm-5', 'gpt-5.3-my'],
        getModelConfig: (modelId: string) => ({
          name: modelId === 'gpt-5.3-my' ? 'GPT-5.3-my' : 'GLM-5',
          envApiKey: 'TEST_API_KEY',
          provider: modelId === 'gpt-5.3-my' ? 'openai' : 'zhipu',
          model: modelId,
        }),
        createFromEnv: () => ({}),
      },
      loadConfigToEnv: vi.fn(() => {
        process.env.AGENT_MODEL = 'gpt-5.3-my';
        return ['C:\\Users\\Administrator\\.renx\\config.json'];
      }),
    });
    mockGetSourceModules.mockResolvedValue(
      modules as unknown as Awaited<ReturnType<typeof sourceModules.getSourceModules>>
    );

    await expect(getAgentModelId()).resolves.toBe('gpt-5.3-my');
    await expect(getAgentModelLabel()).resolves.toBe('GPT-5.3-my');
  });

  it('lists models with current selection', async () => {
    await expect(listAgentModels()).resolves.toEqual([
      {
        id: 'claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet',
        provider: 'anthropic',
        apiKeyEnv: 'TEST_API_KEY',
        configured: true,
        current: false,
      },
      {
        id: 'glm-5',
        name: 'GLM-5',
        provider: 'zhipu',
        apiKeyEnv: 'TEST_API_KEY',
        configured: true,
        current: true,
      },
    ]);
  });

  it('switches model when the target is configured', async () => {
    await expect(switchAgentModel('claude-3.5-sonnet')).resolves.toEqual({
      modelId: 'claude-3.5-sonnet',
      modelLabel: 'Claude 3.5 Sonnet',
    });
  });

  it('keeps the switched model across runtime re-initialization', async () => {
    const modules = buildMockModules({
      loadConfigToEnv: vi.fn(() => {
        process.env.AGENT_MODEL = 'glm-5';
        return ['C:\\Users\\Administrator\\.renx\\config.json'];
      }),
    });
    mockGetSourceModules.mockResolvedValue(
      modules as unknown as Awaited<ReturnType<typeof sourceModules.getSourceModules>>
    );

    await expect(switchAgentModel('claude-3.5-sonnet')).resolves.toEqual({
      modelId: 'claude-3.5-sonnet',
      modelLabel: 'Claude 3.5 Sonnet',
    });

    await expect(getAgentModelId()).resolves.toBe('claude-3.5-sonnet');
    await expect(getAgentModelLabel()).resolves.toBe('Claude 3.5 Sonnet');
    await expect(runAgentPrompt('Test prompt', {})).resolves.toEqual(
      expect.objectContaining({
        modelLabel: 'Claude 3.5 Sonnet',
      })
    );
  });

  it('runs a prompt and returns the assembled result', async () => {
    const handlers: AgentEventHandlers = {
      onTextDelta: vi.fn(),
      onTextComplete: vi.fn(),
      onToolUse: vi.fn(),
      onToolStream: vi.fn(),
      onToolResult: vi.fn(),
      onToolConfirm: vi.fn(),
      onUsage: vi.fn(),
    };

    await expect(runAgentPrompt('Test prompt', handlers)).resolves.toEqual(
      expect.objectContaining({
        text: 'done',
        completionReason: 'stop',
        modelLabel: 'GLM-5',
      })
    );
  });

  it('stores app state under RENX_HOME by default', async () => {
    const modules = buildMockModules();
    const appStoreClass = modules.createSqliteAgentAppStore('/ignore').constructor as {
      lastDbPath?: string;
    };
    mockGetSourceModules.mockResolvedValue(
      modules as unknown as Awaited<ReturnType<typeof sourceModules.getSourceModules>>
    );

    await disposeAgentRuntime();
    await runAgentPrompt('Test prompt', {});

    expect(appStoreClass.lastDbPath).toBe(path.join(renxHome, 'data.db'));
  });

  it('hides file history tools from the parent agent tool list', async () => {
    const modules = buildMockModules();
    const appServiceClass = modules.AgentAppService as {
      lastRequest?: { tools?: Array<{ function?: { name?: string } }> };
    };
    mockGetSourceModules.mockResolvedValue(
      modules as unknown as Awaited<ReturnType<typeof sourceModules.getSourceModules>>
    );

    await runAgentPrompt('Test prompt', {});

    const toolNames =
      appServiceClass.lastRequest?.tools?.map((tool) => tool.function?.name).filter(Boolean) || [];

    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('file_edit');
    expect(toolNames).not.toContain('file_history_list');
    expect(toolNames).not.toContain('file_history_restore');
  });

  it('forwards prompt cache config from env to the app request', async () => {
    const modules = buildMockModules();
    const appServiceClass = modules.AgentAppService as {
      lastRequest?: { config?: Record<string, unknown> };
    };
    mockGetSourceModules.mockResolvedValue(
      modules as unknown as Awaited<ReturnType<typeof sourceModules.getSourceModules>>
    );
    process.env.AGENT_PROMPT_CACHE_KEY = 'cache-{conversationId}';
    process.env.AGENT_PROMPT_CACHE_RETENTION = '24h';

    await runAgentPrompt('Test prompt', {});

    expect(appServiceClass.lastRequest?.config).toEqual({
      prompt_cache_key: expect.stringMatching(/^cache-opentui-/),
      prompt_cache_retention: '24h',
    });
  });

  it('returns run_not_active when appending without an active run', async () => {
    await expect(appendAgentPrompt('Follow up')).resolves.toEqual({
      accepted: false,
      reason: 'run_not_active',
    });
  });

  it('forwards runtime follow-up input to the active app run', async () => {
    let releaseRun!: () => void;
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const modules = buildMockModules({
      AgentAppService: class FakeAppServiceWithDelayedRun {
        static appendRequests: unknown[] = [];

        async listContextMessages() {
          return [];
        }

        async getRun() {
          return null;
        }

        async runForeground(request: unknown) {
          await runGate;
          return {
            executionId: (request as { executionId?: string }).executionId ?? 'exec_runtime',
            conversationId: 'conv_runtime',
            messages: [
              {
                messageId: 'msg_assistant',
                role: 'assistant' as const,
                type: 'assistant-text' as const,
                content: 'done',
                timestamp: Date.now(),
              },
            ],
            events: [],
            finishReason: 'stop' as const,
            steps: 1,
            run: {
              executionId: (request as { executionId?: string }).executionId ?? 'exec_runtime',
              runId: (request as { executionId?: string }).executionId ?? 'exec_runtime',
              conversationId: 'conv_runtime',
              status: 'COMPLETED' as const,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              stepIndex: 1,
            },
          };
        }

        async appendUserInputToRun(request: unknown) {
          FakeAppServiceWithDelayedRun.appendRequests.push(request);
          return {
            accepted: true,
          };
        }
      },
    });
    const appServiceClass = modules.AgentAppService as {
      appendRequests?: Array<{
        executionId?: string;
        conversationId?: string;
        userInput?: unknown;
      }>;
    };
    mockGetSourceModules.mockResolvedValue(
      modules as unknown as Awaited<ReturnType<typeof sourceModules.getSourceModules>>
    );

    const runPromise = runAgentPrompt('Test prompt', {});
    await Promise.resolve();

    await expect(appendAgentPrompt('Follow up prompt')).resolves.toEqual({
      accepted: true,
      reason: undefined,
    });

    expect(appServiceClass.appendRequests).toHaveLength(1);
    expect(appServiceClass.appendRequests?.[0]).toMatchObject({
      conversationId: expect.stringMatching(/^opentui-/),
      userInput: 'Follow up prompt',
    });
    expect(appServiceClass.appendRequests?.[0]?.executionId).toMatch(/^exec_cli_/);

    releaseRun();
    await runPromise;
  });
});
