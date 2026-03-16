import { z } from 'zod';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import { StructuredToolHandler } from '../registry';
import { objectSchema, stringSchema, taskRecordSchema } from '../output-schema';
import {
  createTaskId,
  DEFAULT_RETRY_CONFIG,
  safeJsonClone,
  type RetryConfig,
  type TaskCheckpoint,
  type TaskPriority,
  type TaskRecord,
  type TaskTag,
} from '../task-contracts';
import { ensureTaskGraphNode } from '../task-graph';
import { getTaskStateStoreV2, type TaskStateStoreV2 } from '../task-store';
import { TaskToolV2Error } from '../task-errors';
import { TASK_CREATE_DESCRIPTION } from '../tool-prompts';

const checkpointSchema = z
  .object({
    id: z.string().min(1).describe('Checkpoint identifier'),
    name: z.string().min(1).describe('Checkpoint display name'),
    completed: z.boolean().optional().describe('Whether the checkpoint is already completed'),
  })
  .strict();

const retryConfigSchema = z
  .object({
    maxRetries: z.number().int().min(0).describe('Maximum retry attempts'),
    retryDelayMs: z.number().int().min(0).describe('Initial delay between retries in milliseconds'),
    backoffMultiplier: z.number().min(1).describe('Exponential backoff multiplier'),
    retryOn: z.array(z.string().min(1)).describe('Error categories that should trigger retry'),
  })
  .strict();

const tagSchema = z
  .object({
    name: z.string().min(1).describe('Tag name'),
    color: z.string().optional().describe('Optional color hint'),
    category: z.string().optional().describe('Optional tag category'),
  })
  .strict();

const schema = z
  .object({
    namespace: z.string().min(1).optional().describe('Optional task namespace'),
    subject: z.string().min(3).describe('Brief actionable title in imperative form'),
    description: z
      .string()
      .min(10)
      .describe('Detailed task description with context and acceptance criteria'),
    activeForm: z
      .string()
      .min(1)
      .optional()
      .describe('Present continuous form shown while the task is in progress'),
    priority: z.enum(['critical', 'high', 'normal', 'low']).optional().describe('Task priority'),
    tags: z.array(tagSchema).optional().describe('Optional task tags'),
    checkpoints: z
      .array(checkpointSchema)
      .optional()
      .describe('Optional checkpoints for progress tracking'),
    retryConfig: retryConfigSchema.optional().describe('Optional retry behavior configuration'),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Optional timeout budget in milliseconds'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata map'),
    createdBy: z.string().optional().describe('Optional actor identifier that created the task'),
  })
  .strict();

export interface TaskToolV2Options {
  readonly store?: TaskStateStoreV2;
  readonly defaultNamespace?: string;
}

export class TaskCreateToolV2 extends StructuredToolHandler<typeof schema> {
  private readonly store: TaskStateStoreV2;
  private readonly defaultNamespace?: string;

  constructor(options: TaskToolV2Options = {}) {
    super({
      name: 'task_create',
      description: TASK_CREATE_DESCRIPTION,
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
    const created = await this.store.updateState(namespace, (state) => {
      const now = Date.now();
      const subject = args.subject.trim();
      const duplicate = Object.values(state.tasks).find(
        (task) =>
          task.subject === subject &&
          task.status !== 'completed' &&
          task.status !== 'cancelled' &&
          task.status !== 'failed'
      );
      if (duplicate) {
        throw new TaskToolV2Error(`duplicate active task subject already exists: ${duplicate.id}`, {
          errorCode: 'TASK_DUPLICATE_SUBJECT',
          category: 'conflict',
          details: {
            namespace: this.store.normalizeNamespace(namespace),
            taskId: duplicate.id,
            subject,
          },
        });
      }

      const checkpoints: TaskCheckpoint[] = (args.checkpoints || []).map((checkpoint) => ({
        id: checkpoint.id,
        name: checkpoint.name,
        completed: checkpoint.completed || false,
      }));
      const retryConfig: RetryConfig = args.retryConfig
        ? safeJsonClone(args.retryConfig as RetryConfig)
        : safeJsonClone(DEFAULT_RETRY_CONFIG);
      const tags: TaskTag[] = (args.tags || []).map((tag) => safeJsonClone(tag));
      const taskId = createTaskId(now);
      const task: TaskRecord = {
        id: taskId,
        subject,
        description: args.description.trim(),
        activeForm: args.activeForm?.trim() || `${subject} in progress`,
        status: 'pending',
        priority: (args.priority || 'normal') as TaskPriority,
        owner: null,
        blockedBy: [],
        blocks: [],
        progress: 0,
        checkpoints,
        retryConfig,
        retryCount: 0,
        timeoutMs: args.timeoutMs,
        tags,
        metadata: safeJsonClone(args.metadata || {}),
        history: [
          {
            timestamp: now,
            action: 'created',
            actor: args.createdBy || null,
            metadata: {
              subject,
            },
          },
        ],
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      state.tasks[taskId] = task;
      ensureTaskGraphNode(state.graph, taskId);
      return safeJsonClone(task);
    });

    const structured = {
      namespace: this.store.normalizeNamespace(namespace),
      task: created.result,
    };
    return {
      output: JSON.stringify(structured),
      structured,
      metadata: {
        namespace: structured.namespace,
        taskId: created.result.id,
        status: created.result.status,
      },
    };
  }
}
