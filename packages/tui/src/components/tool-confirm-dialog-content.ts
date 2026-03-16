import type { AgentToolPromptEvent } from '../agent/runtime/types';
import { getToolHiddenArgumentKeys, getToolDisplayName } from './tool-display-config';

export type ToolConfirmDialogContent = {
  summary: string;
  detail?: string;
  reason?: string;
  requestedPath?: string;
  allowedDirectories: string[];
  permissionItems: Array<{
    label: string;
    values: string[];
  }>;
  argumentItems: Array<{
    label: string;
    value: string;
    multiline?: boolean;
  }>;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
};

const readString = (value: unknown): string | undefined => {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
};

const readStringArray = (value: unknown): string[] => {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
};

const stringifyPretty = (value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatPathTarget = (value: unknown, fallback = '.'): string => {
  return readString(value) ?? fallback;
};

const parseJsonLike = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (
    trimmed.length < 2 ||
    !(
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    )
  ) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const humanizeKey = (key: string): string => {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const formatArgumentValue = (
  value: unknown
): { value: string; multiline?: boolean } | undefined => {
  const normalized = parseJsonLike(value);

  if (typeof normalized === 'string') {
    return normalized.trim().length > 0
      ? {
          value: normalized,
          multiline: normalized.includes('\n'),
        }
      : undefined;
  }

  if (typeof normalized === 'number' || typeof normalized === 'boolean') {
    return { value: String(normalized) };
  }

  const pretty = stringifyPretty(normalized);
  if (!pretty) {
    return undefined;
  }

  return {
    value: pretty,
    multiline: true,
  };
};

const buildArgumentItems = (
  event: AgentToolPromptEvent
): ToolConfirmDialogContent['argumentItems'] => {
  if (event.kind === 'permission') {
    return [];
  }
  const hiddenKeys = new Set(getToolHiddenArgumentKeys(event.toolName));

  return Object.entries(asRecord(event.args)).flatMap(([key, value]) => {
    if (hiddenKeys.has(key)) {
      return [];
    }

    const formatted = formatArgumentValue(value);
    if (!formatted) {
      return [];
    }

    return [
      {
        label: humanizeKey(key),
        value: formatted.value,
        multiline: formatted.multiline,
      },
    ];
  });
};

const buildPermissionItems = (
  event: AgentToolPromptEvent
): ToolConfirmDialogContent['permissionItems'] => {
  if (event.kind !== 'permission') {
    return [];
  }

  const read = event.permissions.fileSystem?.read || [];
  const write = event.permissions.fileSystem?.write || [];
  const hosts = event.permissions.network?.allowedHosts || [];
  const items: ToolConfirmDialogContent['permissionItems'] = [];

  if (read.length > 0) {
    items.push({ label: 'Read access', values: read });
  }
  if (write.length > 0) {
    items.push({ label: 'Write access', values: write });
  }
  if (hosts.length > 0) {
    items.push({ label: 'Network hosts', values: hosts });
  }

  return items;
};

const buildSummary = (
  event: AgentToolPromptEvent,
  selectedScope?: 'turn' | 'session'
): { summary: string; detail?: string } => {
  if (event.kind === 'permission') {
    const displayName = getToolDisplayName(event.toolName);
    const scope = selectedScope ?? event.requestedScope;
    const scopeLabel = scope === 'session' ? 'this session' : 'this turn';
    return {
      summary: `Grant additional permissions for ${displayName}`,
      detail: `Selected scope: ${scopeLabel}`,
    };
  }

  const args = asRecord(event.args);

  switch (event.toolName) {
    case 'local_shell': {
      const command = readString(args.command) ?? '(empty command)';
      const description = readString(args.description);
      return {
        summary: description ? `Run shell: ${description}` : 'Run shell command',
        detail: `$ ${command}`,
      };
    }
    case 'read_file':
      return { summary: `Read ${formatPathTarget(args.path)}` };
    case 'file_edit':
      return { summary: `Edit ${formatPathTarget(args.path)}` };
    case 'write_file':
      return { summary: `Write ${formatPathTarget(args.path)}` };
    case 'glob':
      return {
        summary: `Glob ${readString(args.pattern) ?? '*'}`,
        detail: `Path: ${formatPathTarget(args.path)}`,
      };
    case 'grep':
      return {
        summary: `Grep ${readString(args.pattern) ?? ''}`,
        detail: `Path: ${formatPathTarget(args.path)}`,
      };
    case 'spawn_agent': {
      const displayName = getToolDisplayName(event.toolName);
      return {
        summary: `Run ${displayName} ${(readString(args.role) ?? 'agent').trim()}`,
        detail: readString(args.description),
      };
    }
    case 'cancel_agent':
      return { summary: `Cancel ${readString(args.agentId) ?? 'agent run'}` };
    default:
      return { summary: `Call ${event.toolName}` };
  }
};

export const buildToolConfirmDialogContent = (
  event: AgentToolPromptEvent,
  options?: {
    selectedScope?: 'turn' | 'session';
  }
): ToolConfirmDialogContent => {
  const metadata =
    event.kind === 'approval' ? asRecord(event.metadata) : ({} as Record<string, unknown>);
  const { summary, detail } = buildSummary(event, options?.selectedScope);

  return {
    summary,
    detail,
    reason: readString(event.reason),
    requestedPath: readString(metadata.requestedPath),
    allowedDirectories: readStringArray(metadata.allowedDirectories),
    permissionItems: buildPermissionItems(event),
    argumentItems: buildArgumentItems(event),
  };
};
