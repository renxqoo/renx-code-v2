import { z } from 'zod';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import {
  arraySchema,
  booleanSchema,
  integerSchema,
  objectSchema,
  stringSchema,
  taskPrioritySchema,
  taskStatusSchema,
} from '../output-schema';
import { StructuredToolHandler } from '../registry';
import {
  safeJsonClone,
  type TaskPriority,
  type TaskRecord,
  type TaskStatus,
} from '../task-contracts';
import { getTaskStateStoreV2, type TaskStateStoreV2 } from '../task-store';
import { TASK_LIST_DESCRIPTION } from '../tool-prompts';
import type { TaskToolV2Options } from './task-create';

const schema = z
  .object({
    namespace: z.string().min(1).optional().describe('Optional task namespace'),
    statuses: z
      .array(z.enum(['pending', 'in_progress', 'completed', 'cancelled', 'failed']))
      .optional()
      .describe('Optional status filter'),
    owner: z.string().min(1).optional().describe('Optional owner filter'),
    tag: z.string().min(1).optional().describe('Optional tag-name filter'),
    includeHistory: z.boolean().optional().describe('Include history for each returned task'),
  })
  .strict();

interface TaskSummary {
  id: string;
  subject: string;
  status: TaskStatus;
  priority: TaskPriority;
  owner: string | null;
  blockedBy: string[];
  blocks: string[];
  progress: number;
  isBlocked: boolean;
  canBeClaimed: boolean;
  createdAt: number;
  updatedAt: number;
  history?: unknown;
}

function toSummary(task: TaskRecord, taskMap: Record<string, TaskRecord>): TaskSummary {
  const blockingCount = task.blockedBy.filter((taskId) => {
    const blocker = taskMap[taskId];
    return !blocker || blocker.status !== 'completed';
  }).length;
  return {
    id: task.id,
    subject: task.subject,
    status: task.status,
    priority: task.priority,
    owner: task.owner,
    blockedBy: safeJsonClone(task.blockedBy),
    blocks: safeJsonClone(task.blocks),
    progress: task.progress,
    isBlocked: blockingCount > 0,
    canBeClaimed: task.status === 'pending' && blockingCount === 0 && !task.owner,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function rankSummary(summary: TaskSummary): number {
  if (summary.canBeClaimed && summary.priority === 'critical') return 0;
  if (summary.status === 'in_progress') return 1;
  if (summary.canBeClaimed && summary.priority === 'high') return 2;
  if (summary.canBeClaimed && summary.priority === 'normal') return 3;
  if (summary.canBeClaimed && summary.priority === 'low') return 4;
  if (summary.isBlocked) return 5;
  if (summary.status === 'completed') return 6;
  if (summary.status === 'cancelled' || summary.status === 'failed') return 7;
  return 8;
}

export class TaskListToolV2 extends StructuredToolHandler<typeof schema> {
  private readonly store: TaskStateStoreV2;
  private readonly defaultNamespace?: string;

  constructor(options: TaskToolV2Options = {}) {
    super({
      name: 'task_list',
      description: TASK_LIST_DESCRIPTION,
      schema,
      outputSchema: objectSchema(
        {
          namespace: stringSchema(),
          total: integerSchema(),
          tasks: arraySchema(
            objectSchema(
              {
                id: stringSchema(),
                subject: stringSchema(),
                status: taskStatusSchema,
                priority: taskPrioritySchema,
                owner: { type: 'string', nullable: true },
                blockedBy: arraySchema(stringSchema()),
                blocks: arraySchema(stringSchema()),
                progress: integerSchema(),
                isBlocked: booleanSchema(),
                canBeClaimed: booleanSchema(),
                createdAt: integerSchema(),
                updatedAt: integerSchema(),
                history: {},
              },
              {
                required: [
                  'id',
                  'subject',
                  'status',
                  'priority',
                  'owner',
                  'blockedBy',
                  'blocks',
                  'progress',
                  'isBlocked',
                  'canBeClaimed',
                  'createdAt',
                  'updatedAt',
                ],
              }
            )
          ),
        },
        {
          required: ['namespace', 'total', 'tasks'],
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
        lockKey: `taskns:${namespace}:list`,
      },
    };
  }

  async execute(args: z.infer<typeof schema>): Promise<ToolHandlerResult> {
    const namespace = args.namespace || this.defaultNamespace;
    const normalizedNamespace = this.store.normalizeNamespace(namespace);
    const state = await this.store.getState(normalizedNamespace);
    let tasks = Object.values(state.tasks);

    if (args.statuses && args.statuses.length > 0) {
      const statusSet = new Set(args.statuses);
      tasks = tasks.filter((task) => statusSet.has(task.status));
    }
    if (args.owner) {
      tasks = tasks.filter((task) => task.owner === args.owner);
    }
    if (args.tag) {
      tasks = tasks.filter((task) => task.tags.some((tag) => tag.name === args.tag));
    }

    const summaries = tasks.map((task) => {
      const summary = toSummary(task, state.tasks);
      if (args.includeHistory === true) {
        summary.history = safeJsonClone(task.history);
      }
      return summary;
    });
    summaries.sort((left, right) => {
      const rankDelta = rankSummary(left) - rankSummary(right);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      if (left.createdAt !== right.createdAt) {
        return left.createdAt - right.createdAt;
      }
      return left.id.localeCompare(right.id);
    });

    const structured = {
      namespace: normalizedNamespace,
      total: summaries.length,
      tasks: summaries,
    };
    return {
      output: JSON.stringify(structured),
      structured,
      metadata: {
        namespace: normalizedNamespace,
        total: summaries.length,
      },
    };
  }
}
