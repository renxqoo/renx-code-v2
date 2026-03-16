import { z } from 'zod';
import type { ToolExecutionContext } from '../context';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import { arraySchema, subagentRecordSchema } from '../output-schema';
import { StructuredToolHandler } from '../registry';
import { SubagentPlatform } from '../agent-runner';

const schema = z
  .object({
    agentIds: z
      .array(z.string().min(1))
      .min(1)
      .describe('One or more subagent run identifiers to wait for'),
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(30 * 60 * 1000)
      .optional()
      .describe('Maximum time to wait before returning'),
  })
  .strict();

export class WaitAgentsToolV2 extends StructuredToolHandler<typeof schema> {
  constructor(private readonly platform: SubagentPlatform) {
    super({
      name: 'wait_agents',
      description: 'Wait for one or more subagents to reach terminal states or until timeout.',
      schema,
      outputSchema: arraySchema(subagentRecordSchema),
      supportsParallel: false,
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
    const records = await this.platform.wait(
      args.agentIds,
      args.timeoutMs ?? 30000,
      context.signal
    );
    return {
      output: JSON.stringify(records),
      structured: records,
      metadata: {
        count: records.length,
      },
    };
  }
}
