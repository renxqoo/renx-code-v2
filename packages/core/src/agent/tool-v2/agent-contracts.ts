import type { ToolSpec } from './contracts';

export type SubagentExecutionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export interface SubagentRole {
  readonly name: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly allowedTools: string[];
  readonly defaultMaxSteps?: number;
}

export interface SubagentExecutionRequest {
  readonly role: string;
  readonly prompt: string;
  readonly description?: string;
  readonly conversationId?: string;
  readonly model?: string;
  readonly maxSteps?: number;
  readonly runInBackground?: boolean;
  readonly metadata?: Record<string, unknown>;
}

export interface SubagentExecutionRecord {
  readonly agentId: string;
  readonly role: string;
  readonly prompt: string;
  readonly description?: string;
  readonly status: SubagentExecutionStatus;
  readonly conversationId: string;
  readonly executionId: string;
  readonly model?: string;
  readonly maxSteps?: number;
  readonly output?: string;
  readonly error?: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly version: number;
}

export interface SubagentRunnerStartRequest {
  readonly role: SubagentRole;
  readonly prompt: string;
  readonly description?: string;
  readonly conversationId: string;
  readonly executionId: string;
  readonly model?: string;
  readonly maxSteps?: number;
  readonly metadata?: Record<string, unknown>;
  readonly signal?: AbortSignal;
}

export interface SubagentRunner {
  start(request: SubagentRunnerStartRequest): Promise<SubagentExecutionRecord>;
  poll(execution: SubagentExecutionRecord): Promise<SubagentExecutionRecord>;
  cancel(execution: SubagentExecutionRecord, reason?: string): Promise<SubagentExecutionRecord>;
}

export interface SubagentExecutionStore {
  get(agentId: string): Promise<SubagentExecutionRecord | null>;
  list(): Promise<SubagentExecutionRecord[]>;
  save(record: SubagentExecutionRecord): Promise<SubagentExecutionRecord>;
}

export interface SubagentPlatformOptions {
  readonly roles: Record<string, SubagentRole>;
  readonly runner: SubagentRunner;
  readonly store: SubagentExecutionStore;
  readonly now?: () => number;
}

export interface SubagentToolFactoryOptions extends SubagentPlatformOptions {
  readonly visibleToolSpecs?: ToolSpec[];
}
