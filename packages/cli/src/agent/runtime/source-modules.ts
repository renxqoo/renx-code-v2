import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { MessageContent } from '../../types/message-content';
import { resolveRepoRoot, resolveWorkspaceRoot } from './workspace-paths';

type ProviderModelConfig = {
  name: string;
  envApiKey: string;
  provider?: string;
  model?: string;
  LLMMAX_TOKENS?: number;
  modalities?: {
    image?: boolean;
    audio?: boolean;
    video?: boolean;
  };
};

export type ProviderRegistryLike = {
  getModelIds: () => string[];
  getModelConfig: (modelId: string) => ProviderModelConfig;
  createFromEnv: (modelId: string, options?: Record<string, unknown>) => unknown;
};
type AgentToolConfirmDecision = {
  approved: boolean;
  message?: string;
};
type AgentToolPermissionGrant = {
  granted: Record<string, unknown>;
  scope: 'turn' | 'session';
};
type AgentToolConfirmRequest = {
  toolCallId: string;
  toolName: string;
  arguments: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};
type AgentToolPermissionRequest = {
  toolCallId: string;
  toolName: string;
  reason?: string;
  requestedScope?: 'turn' | 'session';
  permissions: Record<string, unknown>;
};
type AgentMessage = {
  messageId?: string;
  role: string;
  type?: string;
  content: unknown;
  timestamp?: number;
  metadata?: Record<string, unknown>;
};
type AgentCliEvent = {
  eventType: string;
  data: unknown;
  createdAt: number;
};
type AgentRunContextUsage = {
  stepIndex: number;
  messageCount: number;
  contextTokens: number;
  contextLimitTokens: number;
  contextUsagePercent: number;
};
type TokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};
type AgentRunUsage = {
  sequence: number;
  stepIndex: number;
  messageId: string;
  usage: TokenUsage;
  cumulativeUsage: TokenUsage;
  contextTokens?: number;
  contextLimitTokens?: number;
  contextUsagePercent?: number;
};
type AgentRunResult = {
  executionId: string;
  conversationId: string;
  messages: AgentMessage[];
  events: AgentCliEvent[];
  finishReason: 'stop' | 'max_steps' | 'error';
  steps: number;
  run: {
    errorMessage?: string;
    [key: string]: unknown;
  };
};
type AgentLoggerApi = {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};
export type ToolDecisionLike = AgentToolConfirmDecision;
export type ToolConfirmEventLike = AgentToolConfirmRequest & {
  resolve: (decision: ToolDecisionLike) => void;
};
export type ToolPermissionGrantLike = AgentToolPermissionGrant;
export type ToolPermissionEventLike = AgentToolPermissionRequest & {
  resolve: (grant: ToolPermissionGrantLike) => void;
};
export type AgentV4MessageLike = AgentMessage;
export type CliEventEnvelopeLike = AgentCliEvent;
export type AgentAppRunResultLike = AgentRunResult;
type AgentAppRunRequestLike = {
  executionId?: string;
  conversationId: string;
  userInput: MessageContent;
  historyMessages?: AgentV4MessageLike[];
  bootstrapMessages?: AgentV4MessageLike[];
  systemPrompt?: string;
  tools?: Array<{ type: string; function: Record<string, unknown> }>;
  config?: Record<string, unknown>;
  maxSteps?: number;
  contextLimitTokens?: number;
  abortSignal?: AbortSignal;
  modelLabel?: string;
};
export type AgentAppUsageLike = AgentRunUsage;
export type AgentAppContextUsageLike = AgentRunContextUsage;
type AgentAppRunCallbacksLike = {
  onEvent?: (event: CliEventEnvelopeLike) => void | Promise<void>;
  onContextUsage?: (usage: AgentAppContextUsageLike) => void | Promise<void>;
  onUsage?: (usage: AgentAppUsageLike) => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
};
type AgentAppAppendUserInputRequestLike = {
  executionId: string;
  conversationId: string;
  userInput: MessageContent;
};
type AgentAppAppendUserInputResultLike = {
  accepted: boolean;
  reason?: 'run_not_active' | 'conversation_mismatch' | 'empty_input';
  message?: AgentV4MessageLike;
};

export type AgentAppServiceLike = {
  runForeground: (
    request: AgentAppRunRequestLike,
    callbacks?: AgentAppRunCallbacksLike
  ) => Promise<AgentAppRunResultLike>;
  getRun: (executionId: string) => Promise<unknown>;
  appendUserInputToRun: (
    request: AgentAppAppendUserInputRequestLike
  ) => Promise<AgentAppAppendUserInputResultLike>;
  listContextMessages: (conversationId: string) => Promise<AgentV4MessageLike[]>;
};
type AgentLoggerLike = AgentLoggerApi;
export type StatelessAgentLike = {
  on(eventName: 'tool_confirm', listener: (event: ToolConfirmEventLike) => void): void;
  on(eventName: 'tool_permission', listener: (event: ToolPermissionEventLike) => void): void;
  off(eventName: 'tool_confirm', listener: (event: ToolConfirmEventLike) => void): void;
  off(eventName: 'tool_permission', listener: (event: ToolPermissionEventLike) => void): void;
};
export type ToolSchemaLike = {
  type: string;
  function: {
    name?: string;
    [key: string]: unknown;
  };
};
export type ToolExecutorLike = {
  getToolSchemas: () => ToolSchemaLike[];
};
export type AgentAppStoreLike = {
  close: () => Promise<void>;
  prepare?: () => Promise<void>;
};

type EnterpriseAgentAppCompositionLike = {
  agent: StatelessAgentLike;
  appService: AgentAppServiceLike;
  toolExecutor: ToolExecutorLike;
  store?: AgentAppStoreLike;
};

type StatelessAgentCtor = new (
  provider: unknown,
  toolExecutor: ToolExecutorLike,
  config: Record<string, unknown>
) => StatelessAgentLike;
type AgentAppServiceCtor = new (deps: {
  agent: StatelessAgentLike;
  executionStore: AgentAppStoreLike;
  eventStore: AgentAppStoreLike;
  messageStore: AgentAppStoreLike;
}) => AgentAppServiceLike;
type ToolExecutorCtor = new (options: {
  system: unknown;
  workingDirectory?: string;
}) => ToolExecutorLike;
type CreateEnterpriseAgentAppServiceFn = (options: {
  llmProvider: unknown;
  toolSystem?: unknown;
  toolExecutorOptions?: Record<string, unknown>;
  toolSystemOptions?: Record<string, unknown>;
  organizationPolicy?: Record<string, unknown>;
  organizationPolicyFilePath?: string;
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  agentConfig?: Record<string, unknown>;
  storePath?: string;
}) => EnterpriseAgentAppCompositionLike;
type ShellPolicyProfilesLike = {
  fullAccess: unknown;
};

export type SourceModules = {
  repoRoot: string;
  buildSystemPrompt: (options: Record<string, unknown>) => string;
  ProviderRegistry: ProviderRegistryLike;
  loadEnvFiles: (cwd?: string) => Promise<string[]>;
  loadConfigToEnv: (options?: Record<string, unknown>) => string[];
  resolveDefaultSkillRoots: (workspaceRoot: string, env?: NodeJS.ProcessEnv) => string[];
  resolveRenxDatabasePath: (env?: NodeJS.ProcessEnv) => string;
  resolveRenxTaskDir: (env?: NodeJS.ProcessEnv) => string;
  resolveRenxSkillsDir: (env?: NodeJS.ProcessEnv) => string;
  listAvailableSkills: (options?: { skillRoots?: string[] }) => Array<{
    name: string;
    description: string;
    path: string;
  }>;
  formatAvailableSkillsForBootstrap: (skills: Array<{ name: string; description: string }>) => string;
  createLoggerFromEnv: (env?: NodeJS.ProcessEnv, cwd?: string) => unknown;
  createAgentLoggerAdapter: (
    logger: Record<string, unknown>,
    baseContext?: Record<string, unknown>
  ) => AgentLoggerLike;
  StatelessAgent: StatelessAgentCtor;
  AgentAppService: AgentAppServiceCtor;
  createSqliteAgentAppStore: (dbPath: string) => AgentAppStoreLike;
  createEnterpriseAgentAppService: CreateEnterpriseAgentAppServiceFn;
  createEnterpriseToolSystemV2WithSubagents: (options: Record<string, unknown>) => unknown;
  SHELL_POLICY_PROFILES: ShellPolicyProfilesLike;
  EnterpriseToolExecutor: ToolExecutorCtor;
  getTaskStateStoreV2: (options?: Record<string, unknown>) => unknown;
};

let modulesPromise: Promise<SourceModules> | null = null;

const loadSourceModules = async (): Promise<SourceModules> => {
  const repoRoot = resolveRepoRoot();
  const coreEntry = pathToFileURL(path.join(repoRoot, 'packages/core/src/index.ts')).href;
  const core = await import(coreEntry);

  return {
    repoRoot,
    buildSystemPrompt: core.buildSystemPrompt as SourceModules['buildSystemPrompt'],
    ProviderRegistry: core.ProviderRegistry as ProviderRegistryLike,
    loadEnvFiles: core.loadEnvFiles as SourceModules['loadEnvFiles'],
    loadConfigToEnv: core.loadConfigToEnv as SourceModules['loadConfigToEnv'],
    resolveDefaultSkillRoots:
      core.resolveDefaultSkillRoots as SourceModules['resolveDefaultSkillRoots'],
    resolveRenxDatabasePath:
      core.resolveRenxDatabasePath as SourceModules['resolveRenxDatabasePath'],
    resolveRenxTaskDir: core.resolveRenxTaskDir as SourceModules['resolveRenxTaskDir'],
    resolveRenxSkillsDir: core.resolveRenxSkillsDir as SourceModules['resolveRenxSkillsDir'],
    listAvailableSkills: core.listAvailableSkills as SourceModules['listAvailableSkills'],
    formatAvailableSkillsForBootstrap:
      core.formatAvailableSkillsForBootstrap as SourceModules['formatAvailableSkillsForBootstrap'],
    createLoggerFromEnv: core.createLoggerFromEnv as SourceModules['createLoggerFromEnv'],
    createAgentLoggerAdapter:
      core.createAgentLoggerAdapter as SourceModules['createAgentLoggerAdapter'],
    StatelessAgent: core.StatelessAgent as StatelessAgentCtor,
    AgentAppService: core.AgentAppService as AgentAppServiceCtor,
    createSqliteAgentAppStore:
      core.createSqliteAgentAppStore as SourceModules['createSqliteAgentAppStore'],
    createEnterpriseAgentAppService:
      core.createEnterpriseAgentAppService as SourceModules['createEnterpriseAgentAppService'],
    createEnterpriseToolSystemV2WithSubagents:
      core.createEnterpriseToolSystemV2WithSubagents as SourceModules['createEnterpriseToolSystemV2WithSubagents'],
    SHELL_POLICY_PROFILES: core.SHELL_POLICY_PROFILES as SourceModules['SHELL_POLICY_PROFILES'],
    EnterpriseToolExecutor: core.EnterpriseToolExecutor as ToolExecutorCtor,
    getTaskStateStoreV2: core.getTaskStateStoreV2 as SourceModules['getTaskStateStoreV2'],
  };
};

export const getSourceModules = async () => {
  modulesPromise ??= loadSourceModules().catch((error) => {
    modulesPromise = null;
    throw error;
  });
  return modulesPromise;
};

export { resolveRepoRoot, resolveWorkspaceRoot };
