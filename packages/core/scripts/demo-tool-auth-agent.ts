import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { z } from 'zod';

import type { Chunk, LLMGenerateOptions, LLMRequestMessage } from '../src/providers';
import { LLMProvider } from '../src/providers';
import { createEnterpriseAgentRuntime } from '../src/agent/app';
import { createDefaultUserPrincipal } from '../src/agent/auth';
import {
  EnterpriseToolSystem,
  StructuredToolHandler,
  type ToolExecutionPlan,
} from '../src/agent/tool-v2';
import type { ToolExecutionContext, ToolHandlerResult } from '../src/agent/tool-v2';
import type { Message, StreamEvent } from '../src/agent/types';

const schema = z
  .object({
    target: z.string().min(1).describe('发布目标名称，例如 release-notes'),
  })
  .strict();

class PublishReleaseDemoTool extends StructuredToolHandler<typeof schema> {
  constructor() {
    super({
      name: 'publish_release',
      description: '发布一个示例产物，用于演示 tool、auth、agent 的协作链路。',
      schema,
      supportsParallel: false,
      mutating: true,
      tags: ['demo', 'release'],
    });
  }

  plan(args: z.infer<typeof schema>, context: ToolExecutionContext): ToolExecutionPlan {
    return {
      mutating: true,
      writePaths: [resolveReleasePath(context.workingDirectory, args.target)],
      riskLevel: 'high',
      sensitivity: 'restricted',
    };
  }

  async execute(
    args: z.infer<typeof schema>,
    context: ToolExecutionContext
  ): Promise<ToolHandlerResult> {
    const outputPath = resolveReleasePath(context.workingDirectory, args.target);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(
      outputPath,
      [
        `target=${args.target}`,
        `workspace=${context.workingDirectory}`,
        `principal=${context.authorization.principal.principalId}`,
        `environment=${String(context.authorization.principal.attributes?.environment || 'unknown')}`,
      ].join('\n'),
      'utf8'
    );

    return {
      output: `publish_release succeeded: ${outputPath}`,
      structured: {
        target: args.target,
        outputPath,
      },
    };
  }
}

class DemoProvider extends LLMProvider {
  constructor(private readonly toolName: string) {
    super({} as never);
  }

  async generate(_messages: LLMRequestMessage[], _options?: LLMGenerateOptions): Promise<never> {
    throw new Error('DemoProvider only supports generateStream');
  }

  async *generateStream(messages: LLMRequestMessage[]): AsyncGenerator<Chunk> {
    const lastToolMessage = [...messages].reverse().find((message) => message.role === 'tool');
    if (!lastToolMessage) {
      yield* toToolCallStream('demo_response_1', 'demo_tool_call_1', this.toolName, {
        target: 'release-notes',
      });
      return;
    }

    const toolResult =
      typeof lastToolMessage.content === 'string'
        ? lastToolMessage.content
        : JSON.stringify(lastToolMessage.content);
    yield* toTextStream(`Agent 已收到 tool 结果：${toolResult}`);
  }

  getTimeTimeout(): number {
    return 1000;
  }

  getLLMMaxTokens(): number {
    return 32000;
  }

  getMaxOutputTokens(): number {
    return 4096;
  }
}

async function main(): Promise<void> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-demo-tool-auth-agent-'));
  try {
    const toolSystem = new EnterpriseToolSystem([new PublishReleaseDemoTool()]);

    console.log('=== Demo 1: staging 环境，命中组织策略审批后执行成功 ===');
    await runScenario({
      workspaceDir,
      toolSystem,
      environment: 'staging',
      autoApprove: true,
    });

    console.log('');
    console.log('=== Demo 2: production 环境，命中组织策略 deny，执行前被拦截 ===');
    await runScenario({
      workspaceDir,
      toolSystem,
      environment: 'production',
      autoApprove: true,
    });
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}

async function runScenario(input: {
  workspaceDir: string;
  toolSystem: EnterpriseToolSystem;
  environment: 'staging' | 'production';
  autoApprove: boolean;
}): Promise<void> {
  const runtime = createEnterpriseAgentRuntime({
    llmProvider: new DemoProvider('publish_release'),
    toolSystem: input.toolSystem,
    toolExecutorOptions: {
      workingDirectory: input.workspaceDir,
      principal: createDefaultUserPrincipal('demo-user', 'cli', ['release-manager']),
    },
    organizationPolicy: {
      version: 'demo-policy-v1',
      workspaces: [
        {
          workspaceId: 'demo-workspace',
          rootPath: input.workspaceDir,
          environments: {
            staging: {
              rules: [
                {
                  id: 'staging-publish-approval',
                  effect: 'require_approval',
                  reason: 'staging 环境发布需要审批',
                  priority: 80,
                  approvalKey: 'demo:staging:publish_release',
                  match: {
                    toolNames: ['publish_release'],
                  },
                },
              ],
            },
            production: {
              rules: [
                {
                  id: 'production-publish-deny',
                  effect: 'deny',
                  reason: 'production 环境禁止直接发布',
                  priority: 100,
                  match: {
                    toolNames: ['publish_release'],
                  },
                },
              ],
            },
          },
        },
      ],
    },
  });

  const confirmListener = (info: {
    toolCallId: string;
    toolName: string;
    reason?: string;
    resolve: (decision: { approved: boolean; message?: string }) => void;
  }) => {
    console.log(
      `[Agent -> Approval] tool=${info.toolName} toolCallId=${info.toolCallId} reason=${info.reason || 'n/a'}`
    );
    info.resolve({
      approved: input.autoApprove,
      message: input.autoApprove ? 'demo reviewer approved' : 'demo reviewer denied',
    });
  };

  runtime.agent.on('tool_confirm', confirmListener);

  const messages: Message[] = [
    {
      messageId: `msg_user_${input.environment}`,
      type: 'user',
      role: 'user',
      content: `请发布 release-notes，当前环境是 ${input.environment}`,
      timestamp: Date.now(),
    },
  ];

  const principal = {
    ...createDefaultUserPrincipal('demo-user', 'cli', ['release-manager']),
    workspaceId: 'demo-workspace',
    attributes: {
      environment: input.environment,
    },
  };

  try {
    for await (const event of runtime.agent.runStream(
      {
        executionId: `exec_${input.environment}`,
        conversationId: `conv_${input.environment}`,
        messages,
        principal,
        maxSteps: 4,
      },
      {
        onMessage: async (message) => {
          if (message.type === 'tool-call') {
            console.log('[Message] role=assistant content=<tool call message>');
            return;
          }
          console.log(`[Message] role=${message.role} content=${formatContent(message.content)}`);
        },
      }
    )) {
      printEvent(event);
    }
  } finally {
    runtime.agent.off('tool_confirm', confirmListener);
  }
}

function printEvent(event: StreamEvent): void {
  switch (event.type) {
    case 'tool_call': {
      const payload = event.data as {
        toolCalls?: Array<{
          id: string;
          function: {
            name: string;
            arguments: string;
          };
        }>;
      };
      for (const toolCall of payload.toolCalls || []) {
        if (!isCompleteJson(toolCall.function.arguments)) {
          continue;
        }
        console.log(
          `[Event] tool_call tool=${toolCall.function.name} toolCallId=${toolCall.id} args=${toolCall.function.arguments}`
        );
      }
      return;
    }
    case 'tool_result': {
      const payload = event.data as {
        tool_call_id?: string;
        content?: string;
      };
      console.log(
        `[Event] tool_result toolCallId=${payload.tool_call_id || 'n/a'} content=${payload.content || ''}`
      );
      return;
    }
    case 'done': {
      const payload = event.data as {
        finishReason?: string;
        steps?: number;
      };
      console.log(
        `[Event] done finishReason=${payload.finishReason || 'stop'} steps=${payload.steps || 0}`
      );
      return;
    }
    default:
      return;
  }
}

function resolveReleasePath(workspaceDir: string, target: string): string {
  return path.join(workspaceDir, 'demo-release-output', `${target}.txt`);
}

function toStream(
  chunks: Array<
    Omit<Chunk, 'choices'> & {
      choices?: Array<{ index: number; delta: Record<string, unknown> }>;
    }
  >
): AsyncGenerator<Chunk> {
  return (async function* () {
    for (const chunk of chunks) {
      yield chunk as Chunk;
    }
  })();
}

function toToolCallStream(
  responseId: string,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>
): AsyncGenerator<Chunk> {
  const rawArguments = JSON.stringify(args);
  const splitIndex = Math.max(1, Math.floor(rawArguments.length / 2));
  return toStream([
    {
      id: responseId,
      index: 0,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                id: toolCallId,
                type: 'function',
                index: 0,
                function: {
                  name: toolName,
                  arguments: rawArguments.slice(0, splitIndex),
                },
              },
            ],
          },
        },
      ],
    },
    {
      index: 0,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                id: toolCallId,
                type: 'function',
                index: 0,
                function: {
                  name: toolName,
                  arguments: rawArguments.slice(splitIndex),
                },
              },
            ],
            finish_reason: 'tool_calls',
          },
        },
      ],
    },
  ]);
}

function toTextStream(text: string): AsyncGenerator<Chunk> {
  return toStream([
    {
      index: 0,
      choices: [
        {
          index: 0,
          delta: {
            content: text,
          },
        },
      ],
    },
    {
      index: 0,
      choices: [
        {
          index: 0,
          delta: {
            finish_reason: 'stop',
          },
        },
      ],
    },
  ]);
}

function formatContent(content: Message['content']): string {
  return typeof content === 'string' ? content : JSON.stringify(content);
}

function isCompleteJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
