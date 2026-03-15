import type { AgentLogger } from './agent/agent/logger';
import type {
  RunForegroundRequest,
  RunForegroundResult,
  RunForegroundUsage,
} from './agent/app/agent-app-service';
import type { CliEventEnvelope } from './agent/app/contracts';
import type { ToolConfirmInfo, ToolDecision } from './agent/tool/types';
import type { AgentContextUsage, Message } from './agent/types';
import { ProviderRegistry } from './providers';
import type { ModelConfig } from './providers/types';

export type ProviderModelConfig = ModelConfig;
export type ProviderRegistryApi = typeof ProviderRegistry;
export type AgentMessage = Message;
export type AgentRunRequest = RunForegroundRequest;
export type AgentRunResult = RunForegroundResult;
export type AgentRunUsage = RunForegroundUsage;
export type AgentRunContextUsage = AgentContextUsage;
export type AgentCliEvent = CliEventEnvelope;
export type AgentToolConfirmRequest = ToolConfirmInfo;
export type AgentToolConfirmDecision = ToolDecision;
export type AgentLoggerApi = AgentLogger;
