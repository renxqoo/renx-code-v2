import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseArgv, readBooleanFlag, readStringFlag } from '../shared/argv.js';
import { CliUsageError } from '../shared/errors.js';
import { toJson } from '../shared/output.js';
import { getCoreModules } from '../shared/core-modules.js';
import type { CommandContext, CommandResult } from '../shared/types.js';

type ConfigScope = 'project' | 'global';

type ConfigDocument = Record<string, unknown>;

function loadJson(filePath: string): ConfigDocument {
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ConfigDocument;
    }
    return {};
  } catch {
    return {};
  }
}

function parseJsonLiteral(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return '';
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (trimmed === 'null') {
    return null;
  }
  const asNumber = Number(trimmed);
  if (trimmed.length > 0 && Number.isFinite(asNumber) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
    return asNumber;
  }
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  return raw;
}

function getByPath(source: ConfigDocument, keyPath: string): unknown {
  const segments = keyPath
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return source;
  }

  let current: unknown = source;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function setByPath(source: ConfigDocument, keyPath: string, value: unknown): ConfigDocument {
  const segments = keyPath
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    throw new CliUsageError('Config key cannot be empty.');
  }

  const root: ConfigDocument = JSON.parse(JSON.stringify(source || {}));
  let current: ConfigDocument = root;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const existing = current[segment];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      current[segment] = {};
    }
    current = current[segment] as ConfigDocument;
  }

  current[segments[segments.length - 1]] = value;
  return root;
}

function resolveScope(parsed: ReturnType<typeof parseArgv>): ConfigScope {
  const value = readStringFlag(parsed, 'scope');
  if (!value) {
    return 'project';
  }
  const normalized = value.toLowerCase();
  if (normalized === 'project' || normalized === 'global') {
    return normalized;
  }
  throw new CliUsageError(`Invalid --scope value: ${value}. Allowed: project|global`);
}

function formatValue(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

async function handleList(ctx: CommandContext, argv: string[]): Promise<CommandResult> {
  const parsed = parseArgv(argv, { allowPositionals: false });
  const json = readBooleanFlag(parsed, 'json');
  const scope = resolveScope(parsed);
  const modules = await getCoreModules(ctx.repoRoot);

  const configPath =
    scope === 'global' ? modules.getGlobalConfigPath() : modules.getProjectConfigPath(ctx.cwd);
  const config = loadJson(configPath);

  if (json) {
    return {
      exitCode: 0,
      stdout: toJson({ scope, path: configPath, config }),
    };
  }

  return {
    exitCode: 0,
    stdout: `${JSON.stringify(config, null, 2)}\n`,
  };
}

async function handleGet(ctx: CommandContext, argv: string[]): Promise<CommandResult> {
  const parsed = parseArgv(argv, { allowPositionals: true });
  const json = readBooleanFlag(parsed, 'json');
  const scope = resolveScope(parsed);
  const key = parsed.positionals[0] || readStringFlag(parsed, 'key');
  if (!key) {
    throw new CliUsageError('Usage: renx config get <key> [--scope <project|global>] [--json]');
  }

  const modules = await getCoreModules(ctx.repoRoot);
  const configPath =
    scope === 'global' ? modules.getGlobalConfigPath() : modules.getProjectConfigPath(ctx.cwd);
  const config = loadJson(configPath);
  const value = getByPath(config, key);

  if (json) {
    return {
      exitCode: value === undefined ? 1 : 0,
      stdout: toJson({ scope, key, value, found: value !== undefined, path: configPath }),
    };
  }

  if (value === undefined) {
    return {
      exitCode: 1,
      stderr: `Config key not found: ${key}`,
    };
  }

  return {
    exitCode: 0,
    stdout: `${formatValue(value)}\n`,
  };
}

async function handleSet(ctx: CommandContext, argv: string[]): Promise<CommandResult> {
  const parsed = parseArgv(argv, { allowPositionals: true });
  const scope = resolveScope(parsed);
  const key = parsed.positionals[0] || readStringFlag(parsed, 'key');
  const rawValue = parsed.positionals[1] || readStringFlag(parsed, 'value');

  if (!key || rawValue === undefined) {
    throw new CliUsageError(
      'Usage: renx config set <key> <value> [--scope <project|global>]\nExample: renx config set agent.defaultModel qwen3.5-plus'
    );
  }

  const value = parseJsonLiteral(rawValue);
  const modules = await getCoreModules(ctx.repoRoot);
  modules.ensureConfigDirs(ctx.cwd);

  const currentPath =
    scope === 'global' ? modules.getGlobalConfigPath() : modules.getProjectConfigPath(ctx.cwd);
  const current = loadJson(currentPath);
  const next = setByPath(current, key, value);

  const writtenPath =
    scope === 'global'
      ? modules.writeGlobalConfig(next)
      : modules.writeProjectConfig(next, ctx.cwd);

  return {
    exitCode: 0,
    stdout: `Updated ${scope} config: ${key}=${formatValue(value)}\nPath: ${path.resolve(writtenPath)}\n`,
  };
}

export async function runConfigCommand(ctx: CommandContext): Promise<CommandResult> {
  const [subcommand, ...rest] = ctx.argv;

  if (!subcommand) {
    throw new CliUsageError('Usage: renx config <get|set|list> ...');
  }

  switch (subcommand) {
    case 'list':
      return handleList(ctx, rest);
    case 'get':
      return handleGet(ctx, rest);
    case 'set':
      return handleSet(ctx, rest);
    default:
      throw new CliUsageError(`Unknown config subcommand: ${subcommand}`);
  }
}
