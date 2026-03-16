import type { Tool } from '../../providers';
import type { RunForegroundRequest, RunForegroundResult } from '../app/agent-app-service';
import type { RunRecord } from '../app/contracts';
import type { Message } from '../types';
import type {
  SubagentExecutionRecord,
  SubagentRunner,
  SubagentRunnerStartRequest,
} from './agent-contracts';

interface SubagentAppService {
  runForeground(request: RunForegroundRequest): Promise<RunForegroundResult>;
  getRun(executionId: string): Promise<RunRecord | null>;
  listContextMessages(conversationId: string): Promise<Message[]>;
}

export interface RealSubagentRunnerV2Options {
  readonly appService: SubagentAppService;
  readonly resolveTools?: (toolNames: string[]) => Tool[] | undefined;
  readonly resolveModelId?: (model?: string) => string | undefined;
  readonly now?: () => number;
}

export class RealSubagentRunnerV2 implements SubagentRunner {
  private readonly now: () => number;
  private readonly liveRuns = new Map<string, AbortController>();

  constructor(private readonly options: RealSubagentRunnerV2Options) {
    this.now = options.now || Date.now;
  }

  async start(request: SubagentRunnerStartRequest): Promise<SubagentExecutionRecord> {
    const controller = new AbortController();
    this.liveRuns.set(request.executionId, controller);
    const now = this.now();

    const initial: SubagentExecutionRecord = {
      agentId: request.executionId,
      executionId: request.executionId,
      conversationId: request.conversationId,
      role: request.role.name,
      prompt: request.prompt,
      description: request.description,
      status: 'running',
      model: request.model,
      maxSteps: request.maxSteps,
      metadata: {
        ...(request.metadata || {}),
        systemPrompt: request.role.systemPrompt,
      },
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      version: 1,
    };

    void this.runForeground(initial, request, controller);
    return initial;
  }

  async poll(execution: SubagentExecutionRecord): Promise<SubagentExecutionRecord> {
    const run = await this.options.appService.getRun(execution.executionId);
    if (!run) {
      return execution;
    }

    let output = execution.output;
    if (run.status === 'COMPLETED' && (!output || output.trim().length === 0)) {
      output = await this.readCompletionOutput(execution.conversationId);
    }

    return {
      ...execution,
      status: mapRunStatus(run),
      output: run.status === 'COMPLETED' ? output : undefined,
      error: run.status === 'FAILED' || run.status === 'CANCELLED' ? run.errorMessage : undefined,
      updatedAt: run.updatedAt || this.now(),
      endedAt: run.completedAt || execution.endedAt,
      version: execution.version + 1,
    };
  }

  async cancel(
    execution: SubagentExecutionRecord,
    reason?: string
  ): Promise<SubagentExecutionRecord> {
    const live = this.liveRuns.get(execution.executionId);
    if (live) {
      live.abort(reason || 'Cancelled by tool-v2');
      this.liveRuns.delete(execution.executionId);
    }
    const now = this.now();
    return {
      ...execution,
      status: 'cancelled',
      error: reason || 'Cancelled by tool-v2',
      updatedAt: now,
      endedAt: now,
      version: execution.version + 1,
    };
  }

  private async runForeground(
    _initial: SubagentExecutionRecord,
    request: SubagentRunnerStartRequest,
    controller: AbortController
  ): Promise<void> {
    try {
      const result = await this.options.appService.runForeground({
        conversationId: request.conversationId,
        executionId: request.executionId,
        userInput: request.prompt,
        systemPrompt: request.role.systemPrompt,
        maxSteps: request.maxSteps,
        tools: this.options.resolveTools?.(request.role.allowedTools),
        abortSignal: controller.signal,
        config: this.options.resolveModelId?.(request.model)
          ? { model: this.options.resolveModelId?.(request.model) }
          : undefined,
      });
      void result;
    } finally {
      this.liveRuns.delete(request.executionId);
    }
  }

  private async readCompletionOutput(conversationId: string): Promise<string | undefined> {
    try {
      const messages = await this.options.appService.listContextMessages(conversationId);
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== 'assistant') {
          continue;
        }
        if (typeof message.content === 'string' && message.content.trim().length > 0) {
          return message.content.trim();
        }
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}

function mapRunStatus(run: RunRecord): SubagentExecutionRecord['status'] {
  switch (run.status) {
    case 'CREATED':
    case 'QUEUED':
      return 'queued';
    case 'RUNNING':
      return 'running';
    case 'COMPLETED':
      return 'completed';
    case 'CANCELLED':
      return 'cancelled';
    case 'FAILED':
      return run.terminalReason === 'timeout' ? 'timed_out' : 'failed';
    default:
      return 'failed';
  }
}
