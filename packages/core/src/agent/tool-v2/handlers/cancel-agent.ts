import { z } from 'zod';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import { subagentRecordSchema } from '../output-schema';
import { StructuredToolHandler } from '../registry';
import { SubagentPlatform } from '../agent-runner';

const schema = z
  .object({
    agentId: z.string().min(1).describe('Subagent run identifier to cancel'),
    reason: z.string().optional().describe('Optional cancellation reason recorded in run metadata'),
  })
  .strict();

export class CancelAgentToolV2 extends StructuredToolHandler<typeof schema> {
  constructor(private readonly platform: SubagentPlatform) {
    super({
      name: 'cancel_agent',
      description: 'Cancel a running subagent and persist terminal state.',
      schema,
      outputSchema: subagentRecordSchema,
      supportsParallel: false,
      mutating: true,
      tags: ['agent', 'orchestration'],
    });
  }

  plan(args: z.infer<typeof schema>): ToolExecutionPlan {
    return {
      mutating: true,
      approval: {
        required: true,
        reason: `Cancel subagent ${args.agentId}`,
        key: `cancel-agent:${args.agentId}`,
      },
    };
  }

  async execute(args: z.infer<typeof schema>): Promise<ToolHandlerResult> {
    const record = await this.platform.cancel(args.agentId, args.reason);
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
