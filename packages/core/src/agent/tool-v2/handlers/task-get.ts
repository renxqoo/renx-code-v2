import { z } from 'zod';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import {
  arraySchema,
  integerSchema,
  objectSchema,
  stringSchema,
  taskCanStartSchema,
  taskReferenceSchema,
  taskRecordSchema,
} from '../output-schema';
import { StructuredToolHandler } from '../registry';
import { evaluateTaskCanStart, safeJsonClone, type TaskRecord } from '../task-contracts';
import { getTaskStateStoreV2, type TaskStateStoreV2 } from '../task-store';
import { TaskToolV2Error } from '../task-errors';
import { TASK_GET_DESCRIPTION } from '../tool-prompts';
import type { TaskToolV2Options } from './task-create';

const schema = z
  .object({
    namespace: z.string().min(1).optional().describe('Optional task namespace'),
    taskId: z.string().min(1).describe('Task identifier to retrieve'),
    includeHistory: z.boolean().optional().describe('Include full history entries when true'),
  })
  .strict();

function checkpointProgress(task: TaskRecord): number {
  if (task.checkpoints.length === 0) {
    return 0;
  }
  const completed = task.checkpoints.filter((checkpoint) => checkpoint.completed).length;
  return Math.round((completed / task.checkpoints.length) * 100);
}

export class TaskGetToolV2 extends StructuredToolHandler<typeof schema> {
  private readonly store: TaskStateStoreV2;
  private readonly defaultNamespace?: string;

  constructor(options: TaskToolV2Options = {}) {
    super({
      name: 'task_get',
      description: TASK_GET_DESCRIPTION,
      schema,
      outputSchema: objectSchema(
        {
          namespace: stringSchema(),
          task: objectSchema(
            {
              ...((taskRecordSchema.properties as Record<string, unknown>) || {}),
              blockers: arraySchema(taskReferenceSchema),
              blockedTasks: arraySchema(taskReferenceSchema),
              canStart: taskCanStartSchema,
              checkpointProgress: integerSchema(),
              effectiveProgress: integerSchema(),
            },
            {
              required: ['id', 'subject', 'description', 'activeForm', 'status', 'priority'],
              additionalProperties: true,
            }
          ),
        },
        {
          required: ['namespace', 'task'],
        }
      ),
      supportsParallel: true,
      mutating: false,
      tags: ['task', 'planning'],
    });
    this.store = options.store || getTaskStateStoreV2();
    this.defaultNamespace = options.defaultNamespace;
  }

  plan(args: z.infer<typeof schema>): ToolExecutionPlan {
    const namespace = args.namespace || this.defaultNamespace || 'default';
    return {
      mutating: false,
      concurrency: {
        mode: 'parallel-safe',
        lockKey: `taskns:${namespace}:task:${args.taskId}`,
      },
    };
  }

  async execute(args: z.infer<typeof schema>): Promise<ToolHandlerResult> {
    const namespace = args.namespace || this.defaultNamespace;
    const normalizedNamespace = this.store.normalizeNamespace(namespace);
    const state = await this.store.getState(normalizedNamespace);
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

    const blockers = task.blockedBy.map((taskId) => {
      const blocker = state.tasks[taskId];
      return blocker
        ? {
            id: blocker.id,
            subject: blocker.subject,
            status: blocker.status,
          }
        : {
            id: taskId,
            subject: '(missing task)',
            status: 'missing',
          };
    });
    const blockedTasks = task.blocks.map((taskId) => {
      const blocked = state.tasks[taskId];
      return blocked
        ? {
            id: blocked.id,
            subject: blocked.subject,
            status: blocked.status,
          }
        : {
            id: taskId,
            subject: '(missing task)',
            status: 'missing',
          };
    });
    const taskCheckpointProgress = checkpointProgress(task);
    const canStart = evaluateTaskCanStart(task, state.tasks);
    const detail = {
      ...safeJsonClone(task),
      blockers,
      blockedTasks,
      canStart,
      checkpointProgress: taskCheckpointProgress,
      effectiveProgress: Math.max(task.progress, taskCheckpointProgress),
      history: args.includeHistory === true ? safeJsonClone(task.history) : undefined,
    };

    const structured = {
      namespace: normalizedNamespace,
      task: detail,
    };
    return {
      output: JSON.stringify(structured),
      structured,
      metadata: {
        namespace: normalizedNamespace,
        taskId: task.id,
        status: task.status,
      },
    };
  }
}
