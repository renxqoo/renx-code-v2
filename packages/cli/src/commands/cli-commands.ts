import type { NonInteractiveRunMode } from '../agent/runtime/runtime';

export type CliCommandName =
  | 'tui'
  | 'run'
  | 'ask'
  | 'session:list'
  | 'session:open'
  | 'session:show'
  | 'internal:tree-sitter-diagnose';

export type ParsedCliCommand = {
  command: CliCommandName;
  helpRequested: boolean;
  json: boolean;
  outputMode: 'text' | 'json';
  autoApprove: boolean;
  prompt?: string;
  sessionId?: string;
  modelId?: string;
  cwd?: string;
  errors: string[];
};

const HELP_FLAGS = new Set(['-h', '--help']);
const VERSION_FLAGS = new Set(['-v', '--version']);
const JSON_FLAGS = new Set(['--json']);
const OUTPUT_FLAGS = new Set(['--output']);
const AUTO_APPROVE_FLAGS = new Set(['-y', '--yes', '--auto-approve']);
const SESSION_ID_FLAGS = new Set([
  '--session-id',
  '--sessionId',
  '--conversation-id',
  '--conversationId',
]);
const MODEL_FLAGS = new Set(['--model']);
const CWD_FLAGS = new Set(['--cwd']);
const ID_FLAGS = new Set(['--id']);

const readFlagValue = (argv: string[], index: number): string | null => {
  const inline = argv[index]?.split('=', 2)[1];
  if (inline && inline.trim().length > 0) {
    return inline.trim();
  }

  const next = argv[index + 1];
  if (!next || next.startsWith('-')) {
    return null;
  }

  return next.trim();
};

const normalizePrompt = (parts: string[]): string | undefined => {
  const text = parts.join(' ').trim();
  return text.length > 0 ? text : undefined;
};

const normalizeOutputMode = (value: string | null): 'text' | 'json' | null => {
  if (!value) {
    return null;
  }
  if (value === 'text' || value === 'json') {
    return value;
  }
  return null;
};

export const isVersionFlagOnly = (argv: string[]): boolean =>
  argv.some((token) => VERSION_FLAGS.has(token));

export const buildHelpText = (): string => `Usage:
  renx [options]
  renx run <prompt> [options]
  renx ask <prompt> [options]
  renx session list [options]
  renx session open --id <id>
  renx session show --id <id> [options]

Commands:
  run             Execute a task-oriented prompt
  ask             Ask a question in non-interactive mode
  session list    List local sessions
  session open    Open a session in TUI
  session show    Show session summary

Options:
  --session-id <id>     Reuse an existing session
  --model <model>       Override model
  --cwd <path>          Set working directory
  --output <mode>       Output mode: text | json
  --json                Alias for --output json
  -y, --yes             Auto-approve non-interactive tool prompts
  -h, --help            Show help
  -v, --version         Show version`;

export const parseCliCommand = (argv: string[]): ParsedCliCommand => {
  const errors: string[] = [];
  const positionals: string[] = [];
  let helpRequested = false;
  let outputMode: 'text' | 'json' = 'text';
  let autoApprove = false;
  let sessionId: string | undefined;
  let modelId: string | undefined;
  let cwd: string | undefined;
  let explicitId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    const normalized = token.split('=', 1)[0] ?? token;
    if (HELP_FLAGS.has(normalized)) {
      helpRequested = true;
      continue;
    }
    if (JSON_FLAGS.has(normalized)) {
      outputMode = 'json';
      continue;
    }
    if (OUTPUT_FLAGS.has(normalized)) {
      const value = normalizeOutputMode(readFlagValue(argv, index));
      if (!value) {
        errors.push(`Invalid value for ${normalized}. Expected "text" or "json".`);
      } else {
        outputMode = value;
      }
      if (!token.includes('=')) {
        index += 1;
      }
      continue;
    }
    if (AUTO_APPROVE_FLAGS.has(normalized)) {
      autoApprove = true;
      continue;
    }
    if (VERSION_FLAGS.has(normalized)) {
      continue;
    }
    if (SESSION_ID_FLAGS.has(normalized)) {
      const value = readFlagValue(argv, index);
      if (!value) {
        errors.push(`Missing value for ${normalized}.`);
      } else {
        sessionId = value;
      }
      if (!token.includes('=')) {
        index += 1;
      }
      continue;
    }
    if (MODEL_FLAGS.has(normalized)) {
      const value = readFlagValue(argv, index);
      if (!value) {
        errors.push(`Missing value for ${normalized}.`);
      } else {
        modelId = value;
      }
      if (!token.includes('=')) {
        index += 1;
      }
      continue;
    }
    if (CWD_FLAGS.has(normalized)) {
      const value = readFlagValue(argv, index);
      if (!value) {
        errors.push(`Missing value for ${normalized}.`);
      } else {
        cwd = value;
      }
      if (!token.includes('=')) {
        index += 1;
      }
      continue;
    }
    if (ID_FLAGS.has(normalized)) {
      const value = readFlagValue(argv, index);
      if (!value) {
        errors.push(`Missing value for ${normalized}.`);
      } else {
        explicitId = value;
      }
      if (!token.includes('=')) {
        index += 1;
      }
      continue;
    }

    positionals.push(token);
  }

  const primary = positionals[0];
  if (!primary) {
    return {
      command: 'tui',
      helpRequested,
      json: outputMode === 'json',
      outputMode,
      autoApprove,
      sessionId,
      modelId,
      cwd,
      errors,
    };
  }

  if (primary === '__tree-sitter-diagnose') {
    // Internal-only command used by release smoke tests to verify the bundled
    // tree-sitter worker path works after install and binary-cache materialization.
    return {
      command: 'internal:tree-sitter-diagnose',
      helpRequested,
      json: outputMode === 'json',
      outputMode,
      autoApprove,
      sessionId,
      modelId,
      cwd,
      errors,
    };
  }

  if (primary === 'run' || primary === 'ask') {
    const prompt = normalizePrompt(positionals.slice(1));
    if (!prompt && !helpRequested) {
      errors.push(`Missing prompt for renx ${primary}.`);
    }
    return {
      command: primary as NonInteractiveRunMode,
      helpRequested,
      json: outputMode === 'json',
      outputMode,
      autoApprove,
      sessionId,
      modelId,
      cwd,
      prompt,
      errors,
    };
  }

  if (primary === 'session') {
    const action = positionals[1];
    if (action === 'list') {
      return {
        command: 'session:list',
        helpRequested,
        json: outputMode === 'json',
        outputMode,
        autoApprove,
        sessionId,
        modelId,
        cwd,
        errors,
      };
    }

    if (action === 'open') {
      if (!explicitId && !helpRequested) {
        errors.push('Missing session id for renx session open --id <id>.');
      }
      return {
        command: 'session:open',
        helpRequested,
        json: outputMode === 'json',
        outputMode,
        autoApprove,
        sessionId: explicitId,
        modelId,
        cwd,
        errors,
      };
    }

    if (action === 'show') {
      if (!explicitId && !helpRequested) {
        errors.push('Missing session id for renx session show --id <id>.');
      }
      return {
        command: 'session:show',
        helpRequested,
        json: outputMode === 'json',
        outputMode,
        autoApprove,
        sessionId: explicitId,
        modelId,
        cwd,
        errors,
      };
    }

    errors.push(
      'Unknown session command. Use `renx session list`, `renx session open --id <id>`, or `renx session show --id <id>`.'
    );
    return {
      command: 'session:list',
      helpRequested,
      json: outputMode === 'json',
      outputMode,
      autoApprove,
      sessionId,
      modelId,
      cwd,
      errors,
    };
  }

  errors.push(`Unknown command: ${primary}`);
  return {
    command: 'tui',
    helpRequested,
    json: outputMode === 'json',
    outputMode,
    autoApprove,
    sessionId,
    modelId,
    cwd,
    errors,
  };
};
