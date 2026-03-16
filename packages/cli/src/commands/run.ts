import { CliUsageError } from '../shared/errors.js';
import { toJson } from '../shared/output.js';
import { runPromptOnce, createSharedRuntime } from '../shared/runtime.js';
import type { CommandContext, CommandResult } from '../shared/types.js';
import { parseArgv, readBooleanFlag, readStringFlag } from '../shared/argv.js';

function parseMaxSteps(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new CliUsageError(`Invalid --max-steps value: ${raw}`);
  }
  return value;
}

function collectPrompt(positionals: string[]): string {
  const prompt = positionals.join(' ').trim();
  if (!prompt) {
    throw new CliUsageError('Usage: renx run <prompt> [--model <id>] [--json] [--max-steps <n>]');
  }
  return prompt;
}

export async function runRunCommand(
  ctx: CommandContext,
  options: { alias: 'run' | 'ask' } = { alias: 'run' }
): Promise<CommandResult> {
  const parsed = parseArgv(ctx.argv, { allowPositionals: true });
  const json = readBooleanFlag(parsed, 'json');
  const modelId = readStringFlag(parsed, 'model');
  const conversationId = readStringFlag(parsed, 'conversation-id', 'conversationId', 'session-id', 'sessionId');
  const maxSteps = parseMaxSteps(readStringFlag(parsed, 'max-steps', 'maxSteps'));
  const autoApprove = !readBooleanFlag(parsed, 'require-approval');
  const prompt = collectPrompt(parsed.positionals);

  const runtime = await createSharedRuntime({
    repoRoot: ctx.repoRoot,
    cwd: ctx.cwd,
    modelId,
    maxSteps,
    conversationId,
  });

  try {
    const result = await runPromptOnce(runtime, prompt, {
      conversationId,
      maxSteps,
      autoApproveTools: autoApprove,
      autoGrantRequestedPermissions: autoApprove,
    });

    const payload = {
      command: options.alias,
      conversationId: result.run.conversationId,
      executionId: result.run.executionId,
      finishReason: result.run.finishReason,
      steps: result.run.steps,
      modelId: runtime.modelId,
      modelLabel: runtime.modelLabel,
      text: result.assistantText,
      usage: result.usage,
      contextUsage: result.contextUsage,
      terminal: {
        status: result.run.run.status,
        reason: result.run.run.terminalReason,
        error: result.run.run.errorMessage,
      },
    };

    if (json) {
      return {
        exitCode: result.run.finishReason === 'error' ? 1 : 0,
        stdout: toJson(payload),
      };
    }

    const lines = [
      `Conversation: ${payload.conversationId}`,
      `Execution: ${payload.executionId}`,
      `Model: ${payload.modelLabel} (${payload.modelId})`,
      '',
      payload.text || '(empty response)',
    ];

    if (payload.finishReason !== 'stop') {
      lines.push('', `Finish reason: ${payload.finishReason}`);
    }

    if (payload.usage) {
      lines.push(
        '',
        `Usage: prompt=${payload.usage.promptTokens}, completion=${payload.usage.completionTokens}, total=${payload.usage.totalTokens}`
      );
    }

    if (payload.terminal.error) {
      lines.push('', `Error: ${payload.terminal.error}`);
    }

    return {
      exitCode: result.run.finishReason === 'error' ? 1 : 0,
      stdout: `${lines.join('\n')}\n`,
    };
  } finally {
    await runtime.dispose();
  }
}
