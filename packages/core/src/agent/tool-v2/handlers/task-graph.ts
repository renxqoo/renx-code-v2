import { z } from 'zod';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import {
  arraySchema,
  integerSchema,
  objectSchema,
  stringSchema,
  taskCanStartSchema,
  taskSummarySchema,
} from '../output-schema';
import { StructuredToolHandler } from '../registry';
import { evaluateTaskCanStart, type TaskRecord } from '../task-contracts';
import { getTaskStateStoreV2, type TaskStateStoreV2 } from '../task-store';
import { TaskToolV2Error } from '../task-errors';
import { summarizeTask } from '../task-orchestration';
import type { TaskToolV2Options } from './task-create';

const schema = z
  .object({
    namespace: z.string().min(1).optional().describe('Optional task namespace'),
    taskId: z
      .string()
      .min(1)
      .optional()
      .describe('Specific task id to inspect within the dependency graph'),
    includeTransitive: z
      .boolean()
      .optional()
      .describe('Include upstream and downstream transitive dependencies'),
  })
  .strict();

const TASK_GRAPH_DESCRIPTION = `Inspect task dependency graph structure and scheduling readiness.

Use this to:
- Understand blockers and dependents for a task
- Find ready-to-run tasks across a namespace
- Inspect roots, leaves, and dependency edges
- Debug orchestration flow before launching work`;

export class TaskGraphToolV2 extends StructuredToolHandler<typeof schema> {
  private readonly store: TaskStateStoreV2;
  private readonly defaultNamespace?: string;

  constructor(options: TaskToolV2Options = {}) {
    super({
      name: 'task_graph',
      description: TASK_GRAPH_DESCRIPTION,
      schema,
      outputSchema: objectSchema(
        {
          namespace: stringSchema(),
          task: taskSummarySchema,
          blockers: arraySchema(taskSummarySchema),
          dependents: arraySchema(taskSummarySchema),
          upstream: arraySchema(taskSummarySchema),
          downstream: arraySchema(taskSummarySchema),
          canStart: taskCanStartSchema,
          summary: objectSchema(
            {
              taskCount: integerSchema(),
              edgeCount: integerSchema(),
              readyCount: integerSchema(),
              blockedCount: integerSchema(),
              rootCount: integerSchema(),
              leafCount: integerSchema(),
            },
            {
              required: [
                'taskCount',
                'edgeCount',
                'readyCount',
                'blockedCount',
                'rootCount',
                'leafCount',
              ],
            }
          ),
          readyTasks: arraySchema(taskSummarySchema),
          blockedTasks: arraySchema(taskSummarySchema),
          roots: arraySchema(taskSummarySchema),
          leaves: arraySchema(taskSummarySchema),
          edges: arraySchema(
            objectSchema(
              {
                blockerId: stringSchema(),
                dependentId: stringSchema(),
              },
              {
                required: ['blockerId', 'dependentId'],
              }
            )
          ),
        },
        {
          required: ['namespace'],
          additionalProperties: true,
        }
      ),
      supportsParallel: true,
      mutating: false,
      tags: ['task', 'planning', 'graph'],
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
        lockKey: `taskns:${namespace}:graph`,
      },
    };
  }

  async execute(args: z.infer<typeof schema>): Promise<ToolHandlerResult> {
    const namespace = args.namespace || this.defaultNamespace;
    const normalizedNamespace = this.store.normalizeNamespace(namespace);
    const state = await this.store.getState(normalizedNamespace);

    if (args.taskId) {
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

      const includeTransitive = args.includeTransitive ?? true;
      const structured = {
        namespace: normalizedNamespace,
        task: summarizeTask(task),
        blockers: task.blockedBy.map((taskId) => summarizeTaskOrMissing(taskId, state.tasks)),
        dependents: task.blocks.map((taskId) => summarizeTaskOrMissing(taskId, state.tasks)),
        upstream: includeTransitive
          ? collectReachable(state.graph.reverse, task.id).map((taskId) =>
              summarizeTaskOrMissing(taskId, state.tasks)
            )
          : [],
        downstream: includeTransitive
          ? collectReachable(state.graph.adjacency, task.id).map((taskId) =>
              summarizeTaskOrMissing(taskId, state.tasks)
            )
          : [],
        canStart: evaluateTaskCanStart(task, state.tasks),
      };
      return {
        output: JSON.stringify(structured),
        structured,
        metadata: {
          namespace: normalizedNamespace,
          taskId: task.id,
        },
      };
    }

    const tasks = Object.values(state.tasks);
    const edges = Object.entries(state.graph.adjacency).flatMap(([blockerId, dependents]) =>
      dependents.map((dependentId) => ({
        blockerId,
        dependentId,
      }))
    );

    const readyTasks = tasks
      .filter((task) => evaluateTaskCanStart(task, state.tasks).canStart)
      .map((task) => summarizeTask(task));
    const blockedTasks = tasks
      .filter((task) => !evaluateTaskCanStart(task, state.tasks).canStart)
      .map((task) => summarizeTask(task));
    const roots = tasks
      .filter((task) => task.blockedBy.length === 0)
      .map((task) => summarizeTask(task));
    const leaves = tasks
      .filter((task) => task.blocks.length === 0)
      .map((task) => summarizeTask(task));

    const structured = {
      namespace: normalizedNamespace,
      summary: {
        taskCount: tasks.length,
        edgeCount: edges.length,
        readyCount: readyTasks.length,
        blockedCount: blockedTasks.length,
        rootCount: roots.length,
        leafCount: leaves.length,
      },
      readyTasks,
      blockedTasks,
      roots,
      leaves,
      edges,
    };

    return {
      output: JSON.stringify(structured),
      structured,
      metadata: {
        namespace: normalizedNamespace,
        taskCount: tasks.length,
        edgeCount: edges.length,
      },
    };
  }
}

function summarizeTaskOrMissing(
  taskId: string,
  taskMap: Record<string, TaskRecord>
): Record<string, unknown> {
  const task = taskMap[taskId];
  if (!task) {
    return {
      id: taskId,
      subject: '(missing task)',
      status: 'missing',
    };
  }
  return summarizeTask(task);
}

function collectReachable(graph: Record<string, string[]>, startId: string): string[] {
  const visited = new Set<string>();
  const queue = [...(graph[startId] || [])];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    queue.push(...(graph[current] || []));
  }

  return [...visited];
}
