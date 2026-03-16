import { randomUUID } from 'node:crypto';

export const TASK_STATUS_VALUES = [
  'pending',
  'in_progress',
  'completed',
  'cancelled',
  'failed',
] as const;

export type TaskStatus = (typeof TASK_STATUS_VALUES)[number];

export const TASK_PRIORITY_VALUES = ['critical', 'high', 'normal', 'low'] as const;

export type TaskPriority = (typeof TASK_PRIORITY_VALUES)[number];

export interface TaskCheckpoint {
  readonly id: string;
  readonly name: string;
  readonly completed: boolean;
  readonly completedAt?: number;
}

export interface TaskTag {
  readonly name: string;
  readonly color?: string;
  readonly category?: string;
}

export interface RetryConfig {
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly backoffMultiplier: number;
  readonly retryOn: string[];
}

export interface TaskHistoryEntry {
  readonly timestamp: number;
  readonly action: string;
  readonly fromStatus?: TaskStatus;
  readonly toStatus?: TaskStatus;
  readonly actor?: string | null;
  readonly reason?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface TaskRecord {
  readonly id: string;
  subject: string;
  description: string;
  activeForm: string;
  status: TaskStatus;
  priority: TaskPriority;
  owner: string | null;
  blockedBy: string[];
  blocks: string[];
  progress: number;
  checkpoints: TaskCheckpoint[];
  retryConfig: RetryConfig;
  retryCount: number;
  lastError?: string;
  lastErrorAt?: number;
  timeoutMs?: number;
  tags: TaskTag[];
  metadata: Record<string, unknown>;
  history: TaskHistoryEntry[];
  agentId?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  version: number;
}

export interface TaskDependencyGraph {
  adjacency: Record<string, string[]>;
  reverse: Record<string, string[]>;
}

export interface TaskNamespaceState {
  namespace: string;
  tasks: Record<string, TaskRecord>;
  graph: TaskDependencyGraph;
  updatedAt: number;
  schemaVersion: 1;
}

export interface TaskCanStartResult {
  readonly canStart: boolean;
  readonly reason?: string;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  retryDelayMs: 5000,
  backoffMultiplier: 2,
  retryOn: ['timeout', 'network_error'],
};

export const VALID_TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'pending', 'cancelled', 'failed'],
  completed: [],
  cancelled: [],
  failed: ['pending'],
};

export function createTaskId(now: number = Date.now()): string {
  return `task_${now}_${randomUUID().slice(0, 8)}`;
}

export function isTaskTerminal(status: TaskStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

export function validateTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) {
    return true;
  }
  return VALID_TASK_TRANSITIONS[from].includes(to);
}

export function createEmptyTaskNamespaceState(namespace: string): TaskNamespaceState {
  return {
    namespace,
    tasks: {},
    graph: {
      adjacency: {},
      reverse: {},
    },
    updatedAt: Date.now(),
    schemaVersion: 1,
  };
}

export function evaluateTaskCanStart(
  task: TaskRecord,
  allTasks: Record<string, TaskRecord>
): TaskCanStartResult {
  if (task.status !== 'pending') {
    return {
      canStart: false,
      reason: `Task status is ${task.status}, expected pending`,
    };
  }

  if (task.owner) {
    return {
      canStart: false,
      reason: `Task is already owned by ${task.owner}`,
    };
  }

  const cancelledOrFailed: string[] = [];
  const incomplete: string[] = [];
  for (const blockerId of task.blockedBy) {
    const blocker = allTasks[blockerId];
    if (!blocker) {
      incomplete.push(blockerId);
      continue;
    }
    if (blocker.status === 'cancelled' || blocker.status === 'failed') {
      cancelledOrFailed.push(blockerId);
      continue;
    }
    if (blocker.status !== 'completed') {
      incomplete.push(blockerId);
    }
  }

  if (cancelledOrFailed.length > 0) {
    return {
      canStart: false,
      reason: `Blocked by cancelled/failed dependencies: ${cancelledOrFailed.join(', ')}`,
    };
  }

  if (incomplete.length > 0) {
    return {
      canStart: false,
      reason: `Blocked by incomplete dependencies: ${incomplete.join(', ')}`,
    };
  }

  return { canStart: true };
}

export function safeJsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
