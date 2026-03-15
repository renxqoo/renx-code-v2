import {
  AgentAppService,
  BashTool,
  createAgentLoggerAdapter,
  createLoggerFromEnv,
  createSqliteAgentAppStore,
  DefaultToolManager,
  FileEditTool,
  FileHistoryListTool,
  FileHistoryRestoreTool,
  FileReadTool,
  GlobTool,
  GrepTool,
  loadConfigToEnv,
  loadEnvFiles,
  ProviderRegistry,
  RealSubagentRunnerAdapter,
  SkillTool,
  StatelessAgent,
  TaskCreateTool,
  TaskGetTool,
  TaskListTool,
  TaskOutputTool,
  TaskStore,
  TaskStopTool,
  TaskTool,
  TaskUpdateTool,
  WriteFileTool,
} from '@renx-code/core';
import type {
  AgentCliEvent,
  AgentLoggerApi,
  AgentMessage,
  AgentRunContextUsage,
  AgentRunResult,
  AgentRunUsage,
  AgentToolConfirmDecision,
  AgentToolConfirmRequest,
} from '@renx-code/core';

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
export type ToolDecisionLike = AgentToolConfirmDecision;
export type ToolConfirmEventLike = AgentToolConfirmRequest & {
  resolve: (decision: ToolDecisionLike) => void;
};
export type AgentV4MessageLike = AgentMessage;
export type CliEventEnvelopeLike = AgentCliEvent;
export type AgentAppRunResultLike = AgentRunResult;
type AgentAppRunRequestLike = {
  conversationId: string;
  userInput: MessageContent;
  historyMessages?: AgentV4MessageLike[];
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

export type AgentAppServiceLike = {
  runForeground: (
    request: AgentAppRunRequestLike,
    callbacks?: AgentAppRunCallbacksLike
  ) => Promise<AgentAppRunResultLike>;
  listContextMessages: (conversationId: string) => Promise<AgentV4MessageLike[]>;
};
type AgentLoggerLike = AgentLoggerApi;
export type StatelessAgentLike = {
  on: (eventName: 'tool_confirm', listener: (event: ToolConfirmEventLike) => void) => void;
  off: (eventName: 'tool_confirm', listener: (event: ToolConfirmEventLike) => void) => void;
};
export type ToolManagerLike = {
  registerTool: (tool: unknown) => void;
  getTools: () => Array<{ name?: string; toToolSchema?: () => unknown }>;
};
export type AgentAppStoreLike = {
  close: () => Promise<void>;
  prepare?: () => Promise<void>;
};

type StatelessAgentCtor = new (
  provider: unknown,
  toolExecutor: ToolManagerLike,
  config: Record<string, unknown>
) => StatelessAgentLike;
type AgentAppServiceCtor = new (deps: {
  agent: StatelessAgentLike;
  executionStore: AgentAppStoreLike;
  eventStore: AgentAppStoreLike;
  messageStore: AgentAppStoreLike;
}) => AgentAppServiceLike;
type ToolManagerCtor = new (config?: Record<string, unknown>) => ToolManagerLike;
type ToolCtor = new (options?: Record<string, unknown>) => unknown;
type TaskStoreCtor = new (options?: Record<string, unknown>) => unknown;
type TaskRunnerCtor = new (options: Record<string, unknown>) => unknown;

export type SourceModules = {
  repoRoot: string;
  ProviderRegistry: ProviderRegistryLike;
  loadEnvFiles: (cwd?: string) => Promise<string[]>;
  loadConfigToEnv: (options?: Record<string, unknown>) => string[];
  createLoggerFromEnv: (env?: NodeJS.ProcessEnv, cwd?: string) => unknown;
  createAgentLoggerAdapter: (
    logger: Record<string, unknown>,
    baseContext?: Record<string, unknown>
  ) => AgentLoggerLike;
  StatelessAgent: StatelessAgentCtor;
  AgentAppService: AgentAppServiceCtor;
  createSqliteAgentAppStore: (dbPath: string) => AgentAppStoreLike;
  DefaultToolManager: ToolManagerCtor;
  BashTool: ToolCtor;
  WriteFileTool: ToolCtor;
  FileReadTool: ToolCtor;
  FileEditTool: ToolCtor;
  FileHistoryListTool: ToolCtor;
  FileHistoryRestoreTool: ToolCtor;
  GlobTool: ToolCtor;
  GrepTool: ToolCtor;
  SkillTool: ToolCtor;
  TaskTool: ToolCtor;
  TaskCreateTool: ToolCtor;
  TaskGetTool: ToolCtor;
  TaskListTool: ToolCtor;
  TaskUpdateTool: ToolCtor;
  TaskStopTool: ToolCtor;
  TaskOutputTool: ToolCtor;
  TaskStore: TaskStoreCtor;
  RealSubagentRunnerAdapter: TaskRunnerCtor;
};

let modulesPromise: Promise<SourceModules> | null = null;

const loadSourceModules = async (): Promise<SourceModules> => {
  const repoRoot = resolveRepoRoot();

  return {
    repoRoot,
    ProviderRegistry: ProviderRegistry as unknown as ProviderRegistryLike,
    loadEnvFiles,
    loadConfigToEnv,
    createLoggerFromEnv,
    createAgentLoggerAdapter:
      createAgentLoggerAdapter as unknown as SourceModules['createAgentLoggerAdapter'],
    StatelessAgent: StatelessAgent as unknown as StatelessAgentCtor,
    AgentAppService: AgentAppService as unknown as AgentAppServiceCtor,
    createSqliteAgentAppStore,
    DefaultToolManager: DefaultToolManager as unknown as ToolManagerCtor,
    BashTool,
    WriteFileTool,
    FileReadTool,
    FileEditTool,
    FileHistoryListTool,
    FileHistoryRestoreTool,
    GlobTool,
    GrepTool,
    SkillTool,
    TaskTool,
    TaskCreateTool,
    TaskGetTool,
    TaskListTool,
    TaskUpdateTool,
    TaskStopTool,
    TaskOutputTool,
    TaskStore: TaskStore as unknown as TaskStoreCtor,
    RealSubagentRunnerAdapter: RealSubagentRunnerAdapter as unknown as TaskRunnerCtor,
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
