import { runRunCommand } from './run.js';
import type { CommandContext, CommandResult } from '../shared/types.js';

export async function runAskCommand(ctx: CommandContext): Promise<CommandResult> {
  return runRunCommand(ctx, { alias: 'ask' });
}
