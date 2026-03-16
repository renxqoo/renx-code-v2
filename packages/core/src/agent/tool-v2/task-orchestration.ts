import type { SubagentExecutionRecord } from './agent-contracts';
import { safeJsonClone, type TaskRecord } from './task-contracts';
import type { TaskStateStoreV2 } from './task-store';

export interface LinkedTaskBinding {
  readonly namespace: string;
  readonly taskId: string;
}

export function resolveLinkedTaskBinding(
  metadata?: Record<string, unknown>,
  explicit?: {
    taskId?: string;
    namespace?: string;
  }
): LinkedTaskBinding | null {
  const taskId =
    explicit?.taskId || readString(metadata?.linkedTaskId) || readString(metadata?.taskId);
  if (!taskId) {
    return null;
  }
  return {
    taskId,
    namespace:
      explicit?.namespace ||
      readString(metadata?.taskNamespace) ||
      readString(metadata?.linkedTaskNamespace) ||
      'default',
  };
}

export async function linkTaskToSubagentStart(
  store: TaskStateStoreV2,
  binding: LinkedTaskBinding,
  record: SubagentExecutionRecord
): Promise<void> {
  await store.updateState(binding.namespace, (state) => {
    const task = state.tasks[binding.taskId];
    if (!task) {
      return null;
    }

    const now = Date.now();
    task.agentId = record.agentId;
    if (task.status === 'pending') {
      task.status = 'in_progress';
      task.startedAt = now;
    }
    task.owner = `agent:${record.agentId}`;
    task.updatedAt = now;
    task.version += 1;
    task.history.push({
      timestamp: now,
      action: 'agent_linked',
      actor: 'spawn_agent',
      metadata: {
        agentId: record.agentId,
        agentStatus: record.status,
      },
    });
    return null;
  });
}

export async function syncLinkedTaskFromSubagentRecord(
  store: TaskStateStoreV2,
  record: SubagentExecutionRecord
): Promise<void> {
  const binding = resolveLinkedTaskBinding(record.metadata);
  if (!binding) {
    return;
  }

  await store.updateState(binding.namespace, (state) => {
    const task = state.tasks[binding.taskId];
    if (!task || (task.agentId && task.agentId !== record.agentId)) {
      return null;
    }

    const now = Date.now();
    const previousStatus = task.status;
    task.agentId = record.agentId;

    if (record.status === 'completed') {
      task.status = 'completed';
      task.progress = 100;
      task.owner = null;
      task.completedAt = now;
    } else if (record.status === 'cancelled') {
      task.status = 'cancelled';
      task.owner = null;
      task.cancelledAt = now;
    } else if (record.status === 'failed' || record.status === 'timed_out') {
      task.status = 'failed';
      task.owner = null;
      task.lastError = record.error || `linked agent ${record.status}`;
      task.lastErrorAt = now;
    } else {
      return null;
    }

    task.updatedAt = now;
    task.version += 1;
    task.history.push({
      timestamp: now,
      action: task.status === 'cancelled' ? 'cancelled' : 'status_changed',
      fromStatus: previousStatus,
      toStatus: task.status,
      actor: 'task-orchestration',
      metadata: {
        agentId: record.agentId,
        agentStatus: record.status,
      },
    });
    return null;
  });
}

export async function cancelLinkedTaskFromParentAbort(
  store: TaskStateStoreV2,
  binding: LinkedTaskBinding,
  agentId: string,
  agentStatus: string,
  reason: string,
  actor: string
): Promise<void> {
  await store.updateState(binding.namespace, (state) => {
    const task = state.tasks[binding.taskId];
    if (!task) {
      return null;
    }
    if (task.agentId && task.agentId !== agentId) {
      return null;
    }
    if (task.status === 'completed' || task.status === 'cancelled') {
      return null;
    }

    const now = Date.now();
    const previousStatus = task.status;
    task.status = 'cancelled';
    task.owner = null;
    task.cancelledAt = now;
    task.updatedAt = now;
    task.version += 1;
    task.history.push({
      timestamp: now,
      action: 'cancelled',
      fromStatus: previousStatus,
      toStatus: 'cancelled',
      actor,
      reason,
      metadata: {
        agentId,
        agentStatus,
      },
    });
    return null;
  });
}

export function summarizeTask(task: TaskRecord): Record<string, unknown> {
  return {
    id: task.id,
    subject: task.subject,
    status: task.status,
    priority: task.priority,
    owner: task.owner,
    blockedBy: safeJsonClone(task.blockedBy),
    blocks: safeJsonClone(task.blocks),
    progress: task.progress,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
