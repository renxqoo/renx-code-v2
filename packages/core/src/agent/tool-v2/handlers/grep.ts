import { spawn, spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { rgPath as bundledRgPath } from '@vscode/ripgrep';
import { z } from 'zod';
import type { ToolExecutionContext } from '../context';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import { DEFAULT_IGNORE_GLOBS } from '../filesystem-search';
import { ToolV2ExecutionError } from '../errors';
import {
  arraySchema,
  integerSchema,
  nullableSchema,
  objectSchema,
  stringSchema,
} from '../output-schema';
import { assertReadAccess } from '../permissions';
import { StructuredToolHandler } from '../registry';
import { GREP_TOOL_DESCRIPTION } from '../tool-prompts';

const schema = z
  .object({
    pattern: z.string().min(1).describe('Regex or plain-text pattern to search for'),
    path: z
      .string()
      .optional()
      .describe('Search root directory; defaults to the current workspace'),
    glob: z.string().optional().describe('Optional glob include filter passed to ripgrep'),
    timeoutMs: z
      .number()
      .int()
      .min(100)
      .max(600000)
      .optional()
      .describe('Search timeout in milliseconds'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .optional()
      .describe('Maximum number of matches to collect before truncation'),
  })
  .strict();

interface GrepResultRow {
  readonly file: string;
  readonly line: number | null;
  readonly text: string;
}

export class GrepToolV2 extends StructuredToolHandler<typeof schema> {
  constructor() {
    super({
      name: 'grep',
      description: GREP_TOOL_DESCRIPTION,
      schema,
      outputSchema: objectSchema(
        {
          rootPath: stringSchema(),
          count: integerSchema(),
          matches: arraySchema(
            objectSchema(
              {
                file: stringSchema(),
                line: nullableSchema(integerSchema()),
                text: stringSchema(),
              },
              {
                required: ['file', 'line', 'text'],
              }
            )
          ),
        },
        {
          required: ['rootPath', 'count', 'matches'],
        }
      ),
      supportsParallel: true,
      mutating: false,
      tags: ['filesystem', 'search'],
    });
  }

  plan(args: z.infer<typeof schema>, context: ToolExecutionContext): ToolExecutionPlan {
    return {
      mutating: false,
      readPaths: [args.path || context.workingDirectory],
      concurrency: {
        mode: 'parallel-safe',
        lockKey: `grep:${args.path || context.workingDirectory}:${args.pattern}`,
      },
    };
  }

  async execute(
    args: z.infer<typeof schema>,
    context: ToolExecutionContext
  ): Promise<ToolHandlerResult> {
    const rootPath = assertReadAccess(
      args.path || context.workingDirectory,
      context.workingDirectory,
      context.fileSystemPolicy
    );
    const rg = locateRipgrep();
    const rows = await runRipgrep(rg.command, [...rg.argsPrefix, ...buildArgs(args, rootPath)], {
      timeoutMs: args.timeoutMs ?? 60000,
      maxResults: args.maxResults ?? 200,
      signal: context.signal,
    });

    return {
      output: rows.map((row) => `${row.file}:${row.line ?? '?'} ${row.text}`).join('\n'),
      structured: {
        rootPath,
        count: rows.length,
        matches: rows,
      },
      metadata: {
        rootPath,
        count: rows.length,
      },
    };
  }
}

function buildArgs(args: z.infer<typeof schema>, rootPath: string): string[] {
  const commandArgs = ['--json', '--no-messages', '--smart-case', '--line-number'];
  if (args.glob) {
    commandArgs.push('--glob', args.glob);
  }
  for (const ignorePattern of DEFAULT_IGNORE_GLOBS) {
    commandArgs.push('--glob', `!${ignorePattern}`);
  }
  commandArgs.push('--', args.pattern, rootPath);
  return commandArgs;
}

function locateRipgrep(): { command: string; argsPrefix: string[] } {
  const candidates = Array.from(
    new Set(
      [process.env.RIPGREP_PATH, bundledRgPath, 'rg'].filter((value): value is string => !!value)
    )
  );
  for (const candidate of candidates) {
    const isScript = /\.(cjs|mjs|js)$/i.test(candidate);
    const command = isScript ? process.execPath : candidate;
    const argsPrefix = isScript ? [candidate] : [];
    const probe = spawnSync(command, [...argsPrefix, '--version'], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) {
      return { command, argsPrefix };
    }
  }
  throw new ToolV2ExecutionError('ripgrep executable was not found');
}

async function runRipgrep(
  command: string,
  args: string[],
  options: {
    timeoutMs: number;
    maxResults: number;
    signal?: AbortSignal;
  }
): Promise<GrepResultRow[]> {
  const rows: GrepResultRow[] = [];
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string | Buffer) => {
    stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  });

  const timeout = setTimeout(() => {
    child.kill();
  }, options.timeoutMs);

  if (options.signal) {
    if (options.signal.aborted) {
      child.kill();
    } else {
      options.signal.addEventListener('abort', () => child.kill(), { once: true });
    }
  }

  const reader = readline.createInterface({
    input: child.stdout!,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of reader) {
      if (rows.length >= options.maxResults) {
        child.kill();
        break;
      }
      const record = parseMatchRow(line);
      if (record) {
        rows.push(record);
      }
    }
  } finally {
    clearTimeout(timeout);
    reader.close();
  }

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code));
  });

  if (exitCode === 2) {
    throw new ToolV2ExecutionError(`ripgrep failed: ${stderr.trim() || 'unknown error'}`);
  }
  if (exitCode !== null && exitCode !== 0 && exitCode !== 1) {
    throw new ToolV2ExecutionError(`ripgrep exited with code ${exitCode}`);
  }

  return rows;
}

function parseMatchRow(line: string): GrepResultRow | null {
  if (!line) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const record = parsed as {
    type?: string;
    data?: {
      path?: { text?: string };
      line_number?: number;
      lines?: { text?: string };
    };
  };
  if (record.type !== 'match' || !record.data?.path?.text) {
    return null;
  }
  return {
    file: path.resolve(record.data.path.text),
    line: typeof record.data.line_number === 'number' ? record.data.line_number : null,
    text: record.data.lines?.text?.replace(/\r?\n$/, '') || '',
  };
}
