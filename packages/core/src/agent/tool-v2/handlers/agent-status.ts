import { z } from 'zod';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import { subagentRecordSchema } from '../output-schema';
import { StructuredToolHandler } from '../registry';
import { SubagentPlatform } from '../agent-runner';

const schema = z
  .object({
    agentId: z.string().min(1).describe('Subagent run identifier to inspect'),
  })
  .strict();

export class AgentStatusToolV2 extends StructuredToolHandler<typeof schema> {
  constructor(private readonly platform: SubagentPlatform) {
    super({
      name: 'agent_status',
      description: 'Get the latest status and output projection for a subagent run.',
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

  async execute(args: z.infer<typeof schema>): Promise<ToolHandlerResult> {
    const record = await this.platform.get(args.agentId);
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
