export type EventSourceInfo = {
  executionId?: string;
  conversationId?: string;
};

export type ReplySourceMeta = EventSourceInfo & {
  sourceKey?: string;
  sourceLabel?: string;
  spawnedByLabel?: string;
  spawnToolCallId?: string;
  isSubagent?: boolean;
  showSourceHeader?: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const normalizeToken = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/\|/g, '%7C');
};

const shortenIdentifier = (value: string): string => {
  if (value.length <= 16) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
};

export const buildEventSourceKey = ({
  executionId,
  conversationId,
}: EventSourceInfo): string | undefined => {
  const normalizedExecutionId = normalizeToken(executionId);
  if (normalizedExecutionId) {
    return `exec|${normalizedExecutionId}`;
  }

  const normalizedConversationId = normalizeToken(conversationId);
  if (normalizedConversationId) {
    return `conv|${normalizedConversationId}`;
  }

  return undefined;
};

export const buildToolInstanceKey = (
  source: EventSourceInfo,
  toolCallId: string | undefined
): string | undefined => {
  const normalizedToolCallId = normalizeToken(toolCallId);
  if (!normalizedToolCallId) {
    return undefined;
  }

  const sourceKey = buildEventSourceKey(source);
  return sourceKey ? `${sourceKey}|${normalizedToolCallId}` : normalizedToolCallId;
};

export const formatSubagentSourceLabel = ({
  executionId,
  conversationId,
}: EventSourceInfo): string => {
  const identifier = executionId?.trim() || conversationId?.trim() || 'unknown';
  return `subagent ${shortenIdentifier(identifier)}`;
};

export const readReplySourceMeta = (value: unknown): ReplySourceMeta | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const executionId = typeof record.executionId === 'string' ? record.executionId : undefined;
  const conversationId =
    typeof record.conversationId === 'string' ? record.conversationId : undefined;
  const sourceKey = typeof record.sourceKey === 'string' ? record.sourceKey : undefined;
  const sourceLabel = typeof record.sourceLabel === 'string' ? record.sourceLabel : undefined;
  const spawnedByLabel =
    typeof record.spawnedByLabel === 'string' ? record.spawnedByLabel : undefined;
  const spawnToolCallId =
    typeof record.spawnToolCallId === 'string' ? record.spawnToolCallId : undefined;
  const isSubagent = typeof record.isSubagent === 'boolean' ? record.isSubagent : undefined;
  const showSourceHeader =
    typeof record.showSourceHeader === 'boolean' ? record.showSourceHeader : undefined;

  if (
    executionId === undefined &&
    conversationId === undefined &&
    sourceKey === undefined &&
    sourceLabel === undefined &&
    spawnedByLabel === undefined &&
    spawnToolCallId === undefined &&
    isSubagent === undefined &&
    showSourceHeader === undefined
  ) {
    return null;
  }

  return {
    executionId,
    conversationId,
    sourceKey,
    sourceLabel,
    spawnedByLabel,
    spawnToolCallId,
    isSubagent,
    showSourceHeader,
  };
};

export const withReplySourceMeta = (
  value: unknown,
  meta: ReplySourceMeta
): Record<string, unknown> => {
  const base = asRecord(value) ?? {};
  return {
    ...base,
    ...(meta.executionId ? { executionId: meta.executionId } : {}),
    ...(meta.conversationId ? { conversationId: meta.conversationId } : {}),
    ...(meta.sourceKey ? { sourceKey: meta.sourceKey } : {}),
    ...(meta.sourceLabel ? { sourceLabel: meta.sourceLabel } : {}),
    ...(meta.spawnedByLabel ? { spawnedByLabel: meta.spawnedByLabel } : {}),
    ...(meta.spawnToolCallId ? { spawnToolCallId: meta.spawnToolCallId } : {}),
    ...(meta.isSubagent !== undefined ? { isSubagent: meta.isSubagent } : {}),
    ...(meta.showSourceHeader !== undefined ? { showSourceHeader: meta.showSourceHeader } : {}),
  };
};
