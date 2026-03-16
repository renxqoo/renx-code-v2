import { CliUsageError } from './errors.js';

type ParseArgvOptions = {
  allowPositionals?: boolean;
};

export type ParsedArgv = {
  flags: Map<string, string | boolean>;
  positionals: string[];
};

export function parseArgv(argv: string[], options: ParseArgvOptions = {}): ParsedArgv {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (!token.startsWith('-')) {
      positionals.push(token);
      continue;
    }

    if (token.startsWith('--')) {
      const [name, inlineValue] = token.slice(2).split('=', 2);
      if (!name) {
        throw new CliUsageError(`Invalid option token: ${token}`);
      }

      if (inlineValue !== undefined) {
        flags.set(name, inlineValue);
        continue;
      }

      const next = argv[index + 1];
      if (next && !next.startsWith('-')) {
        flags.set(name, next);
        index += 1;
        continue;
      }

      flags.set(name, true);
      continue;
    }

    const shortName = token.slice(1);
    if (!shortName) {
      throw new CliUsageError(`Invalid option token: ${token}`);
    }
    flags.set(shortName, true);
  }

  if (!options.allowPositionals && positionals.length > 0) {
    throw new CliUsageError(`Unexpected positional arguments: ${positionals.join(' ')}`);
  }

  return { flags, positionals };
}

export function readStringFlag(parsed: ParsedArgv, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = parsed.flags.get(name);
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export function readBooleanFlag(parsed: ParsedArgv, ...names: string[]): boolean {
  return names.some((name) => parsed.flags.has(name));
}
