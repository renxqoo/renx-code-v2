import { z } from 'zod';
import type { ToolExecutionContext } from '../context';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import { StructuredToolHandler } from '../registry';
import { subagentRecordSchema } from '../output-schema';
import { SubagentPlatform } from '../agent-runner';
import { attachSubagentParentAbortCascade } from '../task-parent-abort';
import { linkTaskToSubagentStart, resolveLinkedTaskBinding } from '../task-orchestration';
import type { TaskStateStoreV2 } from '../task-store';
import { TASK_TOOL_DESCRIPTION } from '../tool-prompts';

const schema = z
  .object({
    role: z.string().min(1).describe('Configured subagent role to launch'),
    prompt: z.string().min(1).describe('Task instructions for the subagent'),
    description: z.string().optional().describe('Short human-readable summary of the spawned run'),
    model: z.string().optional().describe('Optional model override for this subagent run'),
    maxSteps: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Maximum number of agent steps to allow'),
    runInBackground: z
      .boolean()
      .optional()
      .describe('When true, return immediately without waiting for completion'),
    linkedTaskId: z
      .string()
      .min(1)
      .optional()
      .describe('Planning task id to bind to this spawned subagent'),
    taskNamespace: z.string().min(1).optional().describe('Namespace of the linked planning task'),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Free-form metadata merged into the spawned run record'),
  })
  .strict();


export class SpawnAgentToolV2 extends StructuredToolHandler<typeof schema> {
  constructor(
    private readonly platform: SubagentPlatform,
    private readonly taskStore?: TaskStateStoreV2
  ) {
    super({
      name: 'spawn_agent',
      description: TASK_TOOL_DESCRIPTION,
      schema,
      outputSchema: subagentRecordSchema,
      supportsParallel: true,
      mutating: false,
      tags: ['agent', 'orchestration'],
    });
  }

  plan(): ToolExecutionPlan {
    return {
      mutating: false,
    };
  }

  async execute(
    args: z.infer<typeof schema>,
    context: ToolExecutionContext
  ): Promise<ToolHandlerResult> {
    const metadata = {
      ...(args.metadata || {}),
      ...(args.linkedTaskId ? { linkedTaskId: args.linkedTaskId } : {}),
      ...(args.taskNamespace ? { taskNamespace: args.taskNamespace } : {}),
    };
    const record = await this.platform.start(
      {
        role: args.role,
        prompt: args.prompt,
        description: args.description,
        model: args.model,
        maxSteps: args.maxSteps,
        runInBackground: args.runInBackground,
        metadata,
      },
      context.signal
    );
    const linkedTask = resolveLinkedTaskBinding(metadata, {
      taskId: args.linkedTaskId,
      namespace: args.taskNamespace,
    });
    if (this.taskStore && linkedTask) {
      await linkTaskToSubagentStart(this.taskStore, linkedTask, record);
    }
    const detach = attachSubagentParentAbortCascade({
      context,
      platform: this.platform,
      agentId: record.agentId,
      linkedTask,
      taskStore: this.taskStore,
    });
    if (
      record.status === 'completed' ||
      record.status === 'failed' ||
      record.status === 'cancelled' ||
      record.status === 'timed_out'
    ) {
      detach();
    }
    return {
      output: JSON.stringify(record),
      structured: record,
      metadata: {
        agentId: record.agentId,
        status: record.status,
      },
    };
  }
}
