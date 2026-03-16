import { z } from 'zod';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import { objectSchema, stringSchema, taskRecordSchema } from '../output-schema';
import { StructuredToolHandler } from '../registry';
import {
  evaluateTaskCanStart,
  isTaskTerminal,
  safeJsonClone,
  validateTaskTransition,
  type TaskHistoryEntry,
} from '../task-contracts';
import {
  addTaskDependencyEdge,
  ensureTaskGraphNode,
  removeTaskDependencyEdge,
  taskDependencyWouldCycle,
} from '../task-graph';
import { getTaskStateStoreV2, type TaskStateStoreV2 } from '../task-store';
import { TaskToolV2Error } from '../task-errors';
import { TASK_UPDATE_DESCRIPTION } from '../tool-prompts';
import type { TaskToolV2Options } from './task-create';

const schema = z
  .object({
    namespace: z.string().min(1).optional().describe('Optional task namespace'),
    taskId: z.string().min(1).describe('Task identifier to update'),
    status: z
      .enum(['pending', 'in_progress', 'completed', 'cancelled', 'failed'])
      .optional()
      .describe('Optional task status update'),
    expectedVersion: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Optional optimistic lock version'),
    subject: z.string().min(3).optional().describe('Optional task title update'),
    description: z.string().min(10).optional().describe('Optional task description update'),
    activeForm: z.string().min(1).optional().describe('Optional active-form text update'),
    priority: z
      .enum(['critical', 'high', 'normal', 'low'])
      .optional()
      .describe('Optional priority update'),
    owner: z
      .union([z.string().min(1), z.null()])
      .optional()
      .describe('Optional owner update, or null to clear'),
    progress: z.number().int().min(0).max(100).optional().describe('Optional progress percentage'),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Optional metadata merge patch'),
    addBlockedBy: z
      .array(z.string().min(1))
      .optional()
      .describe('Dependency ids to add as blockers'),
    removeBlockedBy: z
      .array(z.string().min(1))
      .optional()
      .describe('Dependency ids to remove from blockers'),
    reason: z.string().optional().describe('Optional reason for update and audit trail'),
    updatedBy: z.string().optional().describe('Optional actor identifier'),
  })
  .strict();

function pushUnique(items: string[], taskId: string): void {
  if (!items.includes(taskId)) {
    items.push(taskId);
  }
}

function removeItem(items: string[], taskId: string): void {
  const index = items.indexOf(taskId);
  if (index >= 0) {
    items.splice(index, 1);
  }
}

export class TaskUpdateToolV2 extends StructuredToolHandler<typeof schema> {
  private readonly store: TaskStateStoreV2;
  private readonly defaultNamespace?: string;

  constructor(options: TaskToolV2Options = {}) {
    super({
      name: 'task_update',
      description: TASK_UPDATE_DESCRIPTION,
      schema,
      outputSchema: objectSchema(
        {
          namespace: stringSchema(),
          task: taskRecordSchema,
        },
        {
          required: ['namespace', 'task'],
        }
      ),
      supportsParallel: false,
      mutating: true,
      tags: ['task', 'planning'],
    });
    this.store = options.store || getTaskStateStoreV2();
    this.defaultNamespace = options.defaultNamespace;
  }

  plan(args: z.infer<typeof schema>): ToolExecutionPlan {
    const namespace = args.namespace || this.defaultNamespace || 'default';
    return {
      mutating: true,
      concurrency: {
        mode: 'exclusive',
        lockKey: `taskns:${namespace}`,
      },
    };
  }

  async execute(args: z.infer<typeof schema>): Promise<ToolHandlerResult> {
    const namespace = args.namespace || this.defaultNamespace;
    const normalizedNamespace = this.store.normalizeNamespace(namespace);

    const hasAnyChange =
      args.status !== undefined ||
      args.subject !== undefined ||
      args.description !== undefined ||
      args.activeForm !== undefined ||
      args.priority !== undefined ||
      args.owner !== undefined ||
      args.progress !== undefined ||
      args.metadata !== undefined ||
      (args.addBlockedBy || []).length > 0 ||
      (args.removeBlockedBy || []).length > 0;
    if (!hasAnyChange) {
      throw new TaskToolV2Error('no update fields provided', {
        errorCode: 'TASK_UPDATE_EMPTY',
        category: 'validation',
        details: {
          namespace: normalizedNamespace,
          taskId: args.taskId,
        },
      });
    }

    const updated = await this.store.updateState(normalizedNamespace, (state) => {
      const task = state.tasks[args.taskId];
      if (!task) {
        throw new TaskToolV2Error(`task not found: ${args.taskId}`, {
          errorCode: 'TASK_NOT_FOUND',
          category: 'not_found',
          details: {
            namespace: normalizedNamespace,
            taskId: args.taskId,
          },
        });
      }
      if (args.expectedVersion && task.version !== args.expectedVersion) {
        throw new TaskToolV2Error(`expected ${args.expectedVersion}, actual ${task.version}`, {
          errorCode: 'TASK_VERSION_CONFLICT',
          category: 'conflict',
          details: {
            namespace: normalizedNamespace,
            taskId: task.id,
            expectedVersion: args.expectedVersion,
            actualVersion: task.version,
          },
        });
      }
      if (isTaskTerminal(task.status)) {
        throw new TaskToolV2Error(`task is terminal (${task.status})`, {
          errorCode: 'TASK_TERMINAL_IMMUTABLE',
          category: 'conflict',
          details: {
            namespace: normalizedNamespace,
            taskId: task.id,
            status: task.status,
          },
        });
      }
      if (args.status && !validateTaskTransition(task.status, args.status)) {
        throw new TaskToolV2Error(`invalid transition ${task.status} -> ${args.status}`, {
          errorCode: 'TASK_INVALID_STATUS_TRANSITION',
          category: 'validation',
          details: {
            namespace: normalizedNamespace,
            taskId: task.id,
            fromStatus: task.status,
            toStatus: args.status,
          },
        });
      }

      const now = Date.now();
      const previousStatus = task.status;
      const previousOwner = task.owner;
      const historyEntries: TaskHistoryEntry[] = [];

      for (const blockerId of args.addBlockedBy || []) {
        const blocker = state.tasks[blockerId];
        if (!blocker) {
          throw new TaskToolV2Error(`blocker task not found: ${blockerId}`, {
            errorCode: 'TASK_NOT_FOUND',
            category: 'not_found',
            details: {
              namespace: normalizedNamespace,
              blockerId,
            },
          });
        }
        if (blockerId === task.id) {
          throw new TaskToolV2Error('task cannot depend on itself', {
            errorCode: 'TASK_CYCLE_DEPENDENCY',
            category: 'conflict',
            details: {
              namespace: normalizedNamespace,
              taskId: task.id,
              blockerId,
            },
          });
        }
        ensureTaskGraphNode(state.graph, blockerId);
        ensureTaskGraphNode(state.graph, task.id);
        if (taskDependencyWouldCycle(state.graph, blockerId, task.id)) {
          throw new TaskToolV2Error(`adding dependency ${blockerId} -> ${task.id} creates cycle`, {
            errorCode: 'TASK_CYCLE_DEPENDENCY',
            category: 'conflict',
            details: {
              namespace: normalizedNamespace,
              taskId: task.id,
              blockerId,
            },
          });
        }
        addTaskDependencyEdge(state.graph, blockerId, task.id);
        pushUnique(task.blockedBy, blockerId);
        pushUnique(blocker.blocks, task.id);
      }
      if ((args.addBlockedBy || []).length > 0) {
        historyEntries.push({
          timestamp: now,
          action: 'dependency_added',
          actor: args.updatedBy || null,
          reason: args.reason,
          metadata: {
            blockedBy: safeJsonClone(args.addBlockedBy || []),
          },
        });
      }

      for (const blockerId of args.removeBlockedBy || []) {
        const blocker = state.tasks[blockerId];
        if (!blocker) {
          continue;
        }
        removeTaskDependencyEdge(state.graph, blockerId, task.id);
        removeItem(task.blockedBy, blockerId);
        removeItem(blocker.blocks, task.id);
      }
      if ((args.removeBlockedBy || []).length > 0) {
        historyEntries.push({
          timestamp: now,
          action: 'dependency_removed',
          actor: args.updatedBy || null,
          reason: args.reason,
          metadata: {
            blockedBy: safeJsonClone(args.removeBlockedBy || []),
          },
        });
      }

      if (args.subject !== undefined) task.subject = args.subject.trim();
      if (args.description !== undefined) task.description = args.description.trim();
      if (args.activeForm !== undefined) task.activeForm = args.activeForm.trim();
      if (args.priority !== undefined) task.priority = args.priority;
      if (args.owner !== undefined) task.owner = args.owner;
      if (args.progress !== undefined) task.progress = args.progress;
      if (args.metadata !== undefined) {
        task.metadata = {
          ...task.metadata,
          ...safeJsonClone(args.metadata),
        };
      }

      if (args.status !== undefined) {
        task.status = args.status;
        if (args.status === 'in_progress' && previousStatus !== 'in_progress') {
          task.startedAt = now;
        }
        if (args.status === 'completed') {
          task.completedAt = now;
          task.progress = 100;
          task.owner = null;
        }
        if (args.status === 'cancelled') {
          task.cancelledAt = now;
          task.owner = null;
        }
        if (
          args.status === 'pending' &&
          previousStatus === 'in_progress' &&
          args.owner === undefined
        ) {
          task.owner = null;
        }
        if (args.status === 'failed') {
          task.lastError = args.reason || task.lastError || 'task marked as failed';
          task.lastErrorAt = now;
          task.owner = null;
        }
      }

      if (args.status !== undefined && previousStatus !== task.status) {
        historyEntries.push({
          timestamp: now,
          action: task.status === 'cancelled' ? 'cancelled' : 'status_changed',
          fromStatus: previousStatus,
          toStatus: task.status,
          actor: args.updatedBy || null,
          reason: args.reason,
        });
      }

      if (args.owner !== undefined && previousOwner !== task.owner) {
        historyEntries.push({
          timestamp: now,
          action: 'owner_changed',
          actor: args.updatedBy || null,
          reason: args.reason,
          metadata: {
            from: previousOwner,
            to: task.owner,
          },
        });
      }

      if (
        args.status === undefined &&
        (args.addBlockedBy || []).length === 0 &&
        (args.removeBlockedBy || []).length === 0
      ) {
        historyEntries.push({
          timestamp: now,
          action: 'updated',
          actor: args.updatedBy || null,
          reason: args.reason,
        });
      }

      task.history.push(...historyEntries);
      task.updatedAt = now;
      task.version += 1;
      ensureTaskGraphNode(state.graph, task.id);
      return safeJsonClone(task);
    });

    const canStart = evaluateTaskCanStart(updated.result, updated.state.tasks);
    const structured = {
      namespace: normalizedNamespace,
      task: updated.result,
      canStart,
    };
    return {
      output: JSON.stringify(structured),
      structured,
      metadata: {
        namespace: normalizedNamespace,
        taskId: updated.result.id,
        status: updated.result.status,
        canStart: canStart.canStart,
      },
    };
  }
}
