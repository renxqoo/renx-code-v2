import type { ToolPermissionProfile, ToolSandboxMode } from './contracts';
import { parse } from 'shell-quote';

export type ShellPolicyEffect = 'allow' | 'ask' | 'deny';
export type ShellExecutionMode = 'sandboxed' | 'escalated';

export interface ShellPolicyDecision {
  readonly effect: ShellPolicyEffect;
  readonly reason?: string;
  readonly commands: string[];
  readonly preferredSandbox?: ToolSandboxMode;
  readonly executionMode?: ShellExecutionMode;
  readonly matchedRule?: string;
  readonly requestedPermissions?: ToolPermissionProfile;
}

export interface ShellPatternRule {
  readonly pattern: RegExp;
  readonly reason: string;
}

export interface ShellCommandPolicy {
  evaluate(command: string): ShellPolicyDecision;
}

export interface ShellCommandRulePatternToken {
  readonly token?: string;
  readonly anyOf?: string[];
}

export interface ShellCommandRule {
  readonly pattern: readonly ShellCommandRulePatternToken[];
  readonly decision: 'allow' | 'prompt' | 'forbidden';
  readonly justification?: string;
  readonly executionMode?: ShellExecutionMode;
  readonly preferredSandbox?: ToolSandboxMode;
  readonly name?: string;
  readonly additionalPermissions?: ToolPermissionProfile;
}

export interface ShellCommandSegmentAssessment {
  readonly segment: string;
  readonly decision: ShellPolicyDecision;
}

export interface ShellCommandAssessment {
  readonly segments: ShellCommandSegmentAssessment[];
  readonly commands: string[];
  readonly effect: ShellPolicyEffect;
  readonly reason?: string;
  readonly preferredSandbox?: ToolSandboxMode;
  readonly executionMode: ShellExecutionMode;
  readonly requestedPermissions?: ToolPermissionProfile;
  readonly requiresApproval: boolean;
  readonly matchedRules: string[];
}

export interface RuleBasedShellCommandPolicyOptions {
  readonly rules: readonly ShellCommandRule[];
  readonly fallback?: ShellCommandPolicy;
}

export interface DefaultShellCommandPolicyOptions {
  readonly safeCommands?: Iterable<string>;
  readonly approvalRequiredCommands?: Iterable<string>;
  readonly deniedPatterns?: Iterable<ShellPatternRule>;
  readonly approvalPatterns?: Iterable<ShellPatternRule>;
  readonly defaultEffect?: ShellPolicyEffect;
  readonly preferredSandbox?: ToolSandboxMode;
}

const DEFAULT_DENIED_PATTERNS: ShellPatternRule[] = [
  {
    pattern: /\b(sudo|su|doas)\b/i,
    reason: 'Refusing privilege escalation command',
  },
  {
    pattern: /\brm\s+-rf\s+\/(\s|$)/i,
    reason: 'Refusing destructive root deletion command',
  },
  {
    pattern: /\b(curl|wget)[^|\n]*\|\s*(sh|bash|zsh)\b/i,
    reason: 'Refusing remote script pipe execution',
  },
  {
    pattern: /\b(sh|bash|zsh)\s+(?:<\(\s*)?(curl|wget)\b/i,
    reason: 'Refusing remote script bootstrap execution',
  },
  {
    pattern: /\b(eval|exec)\s+/i,
    reason: 'Refusing dynamic shell evaluation',
  },
  {
    pattern: /\bpython(?:3)?\s+-[a-z]*c[a-z]*\b/i,
    reason: 'Refusing inline Python execution',
  },
  {
    pattern: /\b(node|nodejs)\s+(?:--eval|-e)\b/i,
    reason: 'Refusing inline Node.js execution',
  },
  {
    pattern: /\b(mkfs(?:\.[A-Za-z0-9_+-]+)?|fdisk|parted)\b/i,
    reason: 'Refusing destructive disk formatting command',
  },
  {
    pattern: /\bdd\s+[^|\n]*\bof=\/dev\//i,
    reason: 'Refusing raw block device write',
  },
  {
    pattern: /\b(shutdown|reboot|halt|poweroff)\b/i,
    reason: 'Refusing host power-control command',
  },
];

const DEFAULT_SAFE_COMMANDS = [
  'ls',
  'dir',
  'pwd',
  'cat',
  'type',
  'head',
  'tail',
  'echo',
  'printf',
  'wc',
  'sort',
  'uniq',
  'cut',
  'awk',
  'sed',
  'grep',
  'rg',
  'find',
  'get-childitem',
  'get-content',
  'select-string',
  'get-process',
  'where-object',
  'select-object',
  'get-item',
  'test-path',
  'resolve-path',
  'gci',
  'gc',
  'sls',
  'foreach-object',
  'git',
  'pnpm',
  'npm',
  'yarn',
  'bun',
  'node',
  'python',
  'python3',
  'pytest',
  'tsc',
  'date',
  'uname',
  'whoami',
  'id',
  'env',
  'printenv',
];

function normalizeCommandToken(token: string): string {
  const trimmed = stripWrappingQuotes(token.trim()).toLowerCase();
  if (!trimmed) {
    return '';
  }
  const slashIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed;
}

export function extractShellCommands(command: string): string[] {
  const tokens = shouldUsePowerShellParsing(command)
    ? parsePowerShellTokens(command)
    : parse(command);
  const commands: string[] = [];
  let expectingCommand = true;

  for (const token of tokens) {
    if (typeof token === 'object' && token !== null && 'op' in token) {
      const operator = String(token.op || '');
      if (
        operator === '|' ||
        operator === '||' ||
        operator === '&&' ||
        operator === ';' ||
        operator === '&'
      ) {
        expectingCommand = true;
      }
      continue;
    }

    if (typeof token !== 'string' || !expectingCommand) {
      continue;
    }

    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      continue;
    }

    const normalized = normalizeCommandToken(token);
    if (!normalized) {
      continue;
    }

    commands.push(normalized);
    expectingCommand = false;
  }

  return commands;
}

export function tokenizeShellCommand(command: string): string[] {
  const tokens = shouldUsePowerShellParsing(command)
    ? parsePowerShellTokens(command)
    : parse(command);
  const result: string[] = [];

  for (const token of tokens) {
    if (typeof token === 'string') {
      const trimmed = stripWrappingQuotes(token.trim());
      if (trimmed) {
        result.push(trimmed);
      }
    }
  }

  return result;
}

export function splitShellCommandSegments(command: string): string[] {
  const tokens = shouldUsePowerShellParsing(command)
    ? parsePowerShellTokens(command)
    : parse(command);
  const segments: string[] = [];
  let current: string[] = [];

  for (const token of tokens) {
    if (typeof token === 'object' && token !== null && 'op' in token) {
      const operator = String(token.op || '');
      if (
        operator === '|' ||
        operator === '||' ||
        operator === '&&' ||
        operator === ';' ||
        operator === '&'
      ) {
        const segment = current.join(' ').trim();
        if (segment) {
          segments.push(segment);
        }
        current = [];
        continue;
      }
    }

    if (typeof token === 'string') {
      const trimmed = token.trim();
      if (trimmed) {
        current.push(trimmed);
      }
    }
  }

  const tail = current.join(' ').trim();
  if (tail) {
    segments.push(tail);
  }

  return segments.length > 0 ? segments : [command.trim()].filter(Boolean);
}

function shouldUsePowerShellParsing(command: string): boolean {
  return (
    /\b(?:pwsh|powershell)(?:\.exe)?\b/i.test(command) ||
    /\$_/.test(command) ||
    /@['"]/.test(command) ||
    /\b(?:Get|Set|New|Remove|Copy|Move|Select|Where|ForEach|Write|Test|Resolve|Join|Split|Start|Stop|Import|Export|Convert|Invoke)-[A-Za-z][A-Za-z0-9]*/.test(
      command
    )
  );
}

function parsePowerShellTokens(command: string): Array<string | { op: string }> {
  const tokens: Array<string | { op: string }> = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let hereString: "'" | '"' | null = null;
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  const flushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) {
      tokens.push(trimmed);
    }
    current = '';
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    const next = command[index + 1];

    if (hereString) {
      current += char;
      if (
        char === hereString &&
        next === '@' &&
        (index === 0 || command[index - 1] === '\n' || command[index - 1] === '\r')
      ) {
        current += next;
        index += 1;
        hereString = null;
      }
      continue;
    }

    if (quote) {
      current += char;
      if (quote === "'" && char === "'" && next === "'") {
        current += next;
        index += 1;
        continue;
      }
      if (quote === '"' && char === '`' && next) {
        current += next;
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if ((char === '@' && next === "'") || (char === '@' && next === '"')) {
      current += `${char}${next}`;
      hereString = next;
      index += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      current += char;
      quote = char;
      continue;
    }

    if (char === '{') {
      braceDepth += 1;
      current += char;
      continue;
    }
    if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      current += char;
      continue;
    }
    if (char === '(') {
      parenDepth += 1;
      current += char;
      continue;
    }
    if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      current += char;
      continue;
    }
    if (char === '[') {
      bracketDepth += 1;
      current += char;
      continue;
    }
    if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += char;
      continue;
    }

    const topLevel = braceDepth === 0 && parenDepth === 0 && bracketDepth === 0;
    if (topLevel && /\s/.test(char)) {
      flushCurrent();
      continue;
    }

    if (topLevel && char === '&' && next === '&') {
      flushCurrent();
      tokens.push({ op: '&&' });
      index += 1;
      continue;
    }
    if (topLevel && char === '|' && next === '|') {
      flushCurrent();
      tokens.push({ op: '||' });
      index += 1;
      continue;
    }
    if (topLevel && (char === '|' || char === ';' || char === '&')) {
      flushCurrent();
      tokens.push({ op: char });
      continue;
    }

    current += char;
  }

  flushCurrent();
  return tokens;
}

function stripWrappingQuotes(token: string): string {
  if (token.length < 2) {
    return token;
  }
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

export function assessShellCommand(
  command: string,
  policy: ShellCommandPolicy
): ShellCommandAssessment {
  const segmentStrings = splitShellCommandSegments(command);
  const segments = segmentStrings.map((segment) => ({
    segment,
    decision: policy.evaluate(segment),
  }));

  const commands = Array.from(new Set(segments.flatMap((segment) => segment.decision.commands)));
  const deny = segments.find((segment) => segment.decision.effect === 'deny');
  const asksForApproval = segments.filter(
    (segment) =>
      segment.decision.effect === 'ask' &&
      !hasRequestedPermissions(segment.decision.requestedPermissions)
  );
  const requestedPermissions = segments.reduce<ToolPermissionProfile | undefined>(
    (merged, segment) => mergePermissionProfiles(merged, segment.decision.requestedPermissions),
    undefined
  );
  const effect: ShellPolicyEffect = deny
    ? 'deny'
    : asksForApproval.length > 0 || hasRequestedPermissions(requestedPermissions)
      ? 'ask'
      : 'allow';

  return {
    segments,
    commands,
    effect,
    reason:
      deny?.decision.reason ||
      asksForApproval[0]?.decision.reason ||
      segments.find((segment) => segment.decision.reason)?.decision.reason,
    preferredSandbox: selectPreferredSandbox(
      segments.map((segment) => segment.decision.preferredSandbox)
    ),
    executionMode: segments.some((segment) => segment.decision.executionMode === 'escalated')
      ? 'escalated'
      : 'sandboxed',
    requestedPermissions,
    requiresApproval: asksForApproval.length > 0,
    matchedRules: Array.from(
      new Set(
        segments
          .map((segment) => segment.decision.matchedRule)
          .filter((rule): rule is string => typeof rule === 'string' && rule.length > 0)
      )
    ),
  };
}

export function evaluateShellPolicy(command: string): ShellPolicyDecision {
  return createDefaultShellCommandPolicy().evaluate(command);
}

export class DefaultShellCommandPolicy implements ShellCommandPolicy {
  private readonly safeCommands: Set<string>;
  private readonly approvalRequiredCommands: Set<string>;
  private readonly deniedPatterns: ShellPatternRule[];
  private readonly approvalPatterns: ShellPatternRule[];
  private readonly defaultEffect: ShellPolicyEffect;
  private readonly preferredSandbox?: ToolSandboxMode;

  constructor(options: DefaultShellCommandPolicyOptions = {}) {
    this.safeCommands = new Set(
      Array.from(options.safeCommands || DEFAULT_SAFE_COMMANDS, (command) =>
        normalizeCommandToken(command)
      ).filter(Boolean)
    );
    this.approvalRequiredCommands = new Set(
      Array.from(options.approvalRequiredCommands || [], (command) =>
        normalizeCommandToken(command)
      ).filter(Boolean)
    );
    this.deniedPatterns = Array.from(options.deniedPatterns || DEFAULT_DENIED_PATTERNS);
    this.approvalPatterns = Array.from(options.approvalPatterns || []);
    this.defaultEffect = options.defaultEffect || 'ask';
    this.preferredSandbox = options.preferredSandbox;
  }

  evaluate(command: string): ShellPolicyDecision {
    const normalized = command.trim();
    if (!normalized) {
      return {
        effect: 'deny',
        reason: 'Command is empty',
        commands: [],
        preferredSandbox: this.preferredSandbox,
        executionMode: 'sandboxed',
      };
    }

    for (const rule of this.deniedPatterns) {
      if (rule.pattern.test(normalized)) {
        return {
          effect: 'deny',
          reason: rule.reason,
          commands: [],
          preferredSandbox: this.preferredSandbox,
          executionMode: 'sandboxed',
        };
      }
    }

    const commands = extractShellCommands(normalized);
    if (commands.length === 0) {
      return {
        effect: 'deny',
        reason: 'Unable to parse executable command',
        commands,
        preferredSandbox: this.preferredSandbox,
        executionMode: 'sandboxed',
      };
    }

    for (const rule of this.approvalPatterns) {
      if (rule.pattern.test(normalized)) {
        return {
          effect: 'ask',
          reason: rule.reason,
          commands,
          preferredSandbox: this.preferredSandbox,
          executionMode: 'sandboxed',
        };
      }
    }

    const requiresApproval = commands.find((entry) => this.approvalRequiredCommands.has(entry));
    if (requiresApproval) {
      return {
        effect: 'ask',
        reason: `Command "${requiresApproval}" requires explicit approval`,
        commands,
        preferredSandbox: this.preferredSandbox,
        executionMode: 'sandboxed',
      };
    }

    const unknown = commands.find((entry) => !this.safeCommands.has(entry));
    if (unknown) {
      return {
        effect: this.defaultEffect,
        reason:
          this.defaultEffect === 'ask'
            ? `Command "${unknown}" requires explicit approval`
            : this.defaultEffect === 'deny'
              ? `Command "${unknown}" is not allowed by this shell policy profile`
              : undefined,
        commands,
        preferredSandbox: this.preferredSandbox,
        executionMode: 'sandboxed',
      };
    }

    return {
      effect: 'allow',
      commands,
      preferredSandbox: this.preferredSandbox,
      executionMode: 'sandboxed',
    };
  }
}

export function createDefaultShellCommandPolicy(
  options: DefaultShellCommandPolicyOptions = {}
): ShellCommandPolicy {
  return new DefaultShellCommandPolicy(options);
}

export class RuleBasedShellCommandPolicy implements ShellCommandPolicy {
  constructor(private readonly options: RuleBasedShellCommandPolicyOptions) {}

  evaluate(command: string): ShellPolicyDecision {
    const argv = tokenizeShellCommand(command);
    for (const rule of this.options.rules) {
      if (!matchesRulePattern(argv, rule.pattern)) {
        continue;
      }

      const effect =
        rule.decision === 'allow' ? 'allow' : rule.decision === 'prompt' ? 'ask' : 'deny';
      return {
        effect,
        reason: rule.justification,
        commands: extractShellCommands(command),
        preferredSandbox: rule.preferredSandbox,
        executionMode:
          rule.executionMode || (rule.decision === 'forbidden' ? 'sandboxed' : 'escalated'),
        matchedRule: rule.name,
        requestedPermissions: rule.additionalPermissions,
      };
    }

    if (this.options.fallback) {
      return this.options.fallback.evaluate(command);
    }

    return createDefaultShellCommandPolicy().evaluate(command);
  }
}

export function createRuleBasedShellCommandPolicy(
  options: RuleBasedShellCommandPolicyOptions
): ShellCommandPolicy {
  return new RuleBasedShellCommandPolicy(options);
}

function matchesRulePattern(
  argv: readonly string[],
  pattern: readonly ShellCommandRulePatternToken[]
): boolean {
  if (pattern.length === 0 || argv.length < pattern.length) {
    return false;
  }

  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index];
    const actual = argv[index];
    if (!expected || !actual) {
      return false;
    }

    if (expected.token !== undefined) {
      if (expected.token !== actual) {
        return false;
      }
      continue;
    }

    if (expected.anyOf && expected.anyOf.length > 0) {
      if (!expected.anyOf.includes(actual)) {
        return false;
      }
      continue;
    }

    return false;
  }

  return true;
}

function mergePermissionProfiles(
  base?: ToolPermissionProfile,
  extra?: ToolPermissionProfile
): ToolPermissionProfile | undefined {
  if (!base && !extra) {
    return undefined;
  }

  return {
    fileSystem: {
      read: Array.from(
        new Set([...(base?.fileSystem?.read || []), ...(extra?.fileSystem?.read || [])])
      ),
      write: Array.from(
        new Set([...(base?.fileSystem?.write || []), ...(extra?.fileSystem?.write || [])])
      ),
    },
    network: {
      enabled: extra?.network?.enabled ?? base?.network?.enabled ?? undefined,
      allowedHosts: Array.from(
        new Set([...(base?.network?.allowedHosts || []), ...(extra?.network?.allowedHosts || [])])
      ),
      deniedHosts: Array.from(
        new Set([...(base?.network?.deniedHosts || []), ...(extra?.network?.deniedHosts || [])])
      ),
    },
  };
}

function hasRequestedPermissions(permissions?: ToolPermissionProfile): boolean {
  return Boolean(
    permissions?.network?.enabled ||
    (permissions?.network?.allowedHosts || []).length > 0 ||
    (permissions?.network?.deniedHosts || []).length > 0 ||
    (permissions?.fileSystem?.read || []).length > 0 ||
    (permissions?.fileSystem?.write || []).length > 0
  );
}

function selectPreferredSandbox(
  modes: Array<ToolSandboxMode | undefined>
): ToolSandboxMode | undefined {
  const ranking: Record<ToolSandboxMode, number> = {
    restricted: 0,
    'workspace-write': 1,
    'full-access': 2,
  };
  let selected: ToolSandboxMode | undefined;
  for (const mode of modes) {
    if (!mode) {
      continue;
    }
    if (!selected || ranking[mode] > ranking[selected]) {
      selected = mode;
    }
  }
  return selected;
}
