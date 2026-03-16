import { runAskCommand } from './commands/ask.js';
import { runConfigCommand } from './commands/config.js';
import { runDoctorCommand } from './commands/doctor.js';
import { renderHelp } from './commands/help.js';
import { runRunCommand } from './commands/run.js';
import { runSessionCommand } from './commands/session.js';
import { runTuiCommand } from './commands/tui.js';
import { CliUsageError, formatError } from './shared/errors.js';
import { resolveRepoRoot, resolveWorkspaceRoot } from './shared/repo.js';
import type { CommandContext, CommandResult } from './shared/types.js';

function writeResult(result: CommandResult): void {
  if (result.stdout) {
    process.stdout.write(result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const repoRoot = resolveRepoRoot();
  const ctx: CommandContext = {
    argv,
    cwd: resolveWorkspaceRoot(),
    env: process.env,
    repoRoot,
  };

  let result: CommandResult;
  try {
    result = await dispatch(ctx);
  } catch (error) {
    const message = formatError(error);
    result = {
      exitCode: error instanceof CliUsageError ? 2 : 1,
      stderr: message,
    };
  }

  writeResult(result);
  process.exit(result.exitCode);
}

async function dispatch(ctx: CommandContext): Promise<CommandResult> {
  const [command, ...rest] = ctx.argv;

  if (!command) {
    return runTuiCommand({ ...ctx, argv: [] });
  }

  if (command === '--help' || command === '-h' || command === 'help') {
    return {
      exitCode: 0,
      stdout: renderHelp(),
    };
  }

  if (command === '--version' || command === '-v') {
    return {
      exitCode: 0,
      stdout: ctx.env.RENX_VERSION || '0.0.0',
    };
  }

  switch (command) {
    case 'tui':
      return runTuiCommand({ ...ctx, argv: rest });
    case 'run':
      return runRunCommand({ ...ctx, argv: rest }, { alias: 'run' });
    case 'ask':
      return runAskCommand({ ...ctx, argv: rest });
    case 'session':
      return runSessionCommand({ ...ctx, argv: rest });
    case 'config':
      return runConfigCommand({ ...ctx, argv: rest });
    case 'doctor':
      return runDoctorCommand({ ...ctx, argv: rest });
    default:
      throw new CliUsageError(
        `Unknown command: ${command}\n\n${renderHelp()}`
      );
  }
}

void main();
