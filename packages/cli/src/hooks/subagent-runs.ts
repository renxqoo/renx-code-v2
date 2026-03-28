import type { ChatTurn, ReplySegment } from '../types/chat';
import type {
  SubagentRunArtifact,
  SubagentRunHighlight,
  SubagentRunStatus,
  SubagentRunTimelineEntry,
  SubagentRunViewModel,
} from '../types/subagent-run';

export type { SubagentRunViewModel } from '../types/subagent-run';

type ParsedToolUse = {
  name: string;
  callId: string;
  args?: Record<string, unknown> | null;
  attributedRunId?: string;
};

type ParsedToolResult = {
  name: string;
  callId: string;
  success: boolean;
  payload?: Record<string, unknown> | null;
  output?: string;
  summary?: string;
  error?: string;
  attributedRunId?: string;
};

type ParsedToolStream = {
  callId: string;
  attributedRunId?: string;
};

type RunAccumulator = {
  runId: string;
  title: string;
  role?: string;
  status: SubagentRunStatus;
  progress?: number;
  linkedTaskId?: string | null;
  latestStatusLine?: string;
  highlights: SubagentRunHighlight[];
  artifacts: SubagentRunArtifact[];
  timeline: SubagentRunTimelineEntry[];
  outputPreview?: string;
  finalSummary?: string;
  firstSeenIndex: number;
  updatedAt: number;
  hiddenToolCallIds: string[];
};

export type ReplyRunProjection = {
  runs: SubagentRunViewModel[];
  hiddenToolCallIds: string[];
};

const readObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const readArray = (value: unknown): unknown[] => {
  return Array.isArray(value) ? value : [];
};

const readString = (value: unknown): string | undefined => {
  return typeof value === 'string' ? value : undefined;
};

const readNumber = (value: unknown): number | undefined => {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const asStatus = (value: unknown): SubagentRunStatus => {
  const status = readString(value);
  switch (status) {
    case 'created':
    case 'queued':
    case 'starting':
    case 'running':
    case 'waiting':
    case 'blocked':
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'timed_out':
      return status;
    case 'in_progress':
      return 'running';
    default:
      return 'running';
  }
};

const truncate = (value: string, maxLength = 140): string => {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
};

const parseArguments = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return readObject(JSON.parse(value));
  } catch {
    return null;
  }
};

const readAttributedRunIds = (value: unknown): string[] => {
  const record = readObject(value);
  if (!record) {
    return [];
  }

  const metadata = readObject(record.metadata);
  const raw = readObject(record.raw);
  const ids = [
    readString(record.agentId),
    readString(record.runId),
    readString(record.executionId),
    readString(metadata?.agentId),
    readString(metadata?.runId),
    readString(metadata?.executionId),
    readString(raw?.agentId),
    readString(raw?.runId),
    readString(raw?.executionId),
  ].filter((id): id is string => Boolean(id));

  return [...new Set(ids)];
};

const readAttributedRunId = (value: unknown): string | undefined => {
  return readAttributedRunIds(value)[0];
};

const resolveCanonicalRunId = (
  runAliasToRunId: Map<string, string>,
  value: unknown
): string | undefined => {
  const rawRunId = readAttributedRunId(value);
  if (!rawRunId) {
    return undefined;
  }
  return runAliasToRunId.get(rawRunId) ?? rawRunId;
};

const registerRunAliases = (
  runAliasToRunId: Map<string, string>,
  canonicalRunId: string,
  value: unknown
): void => {
  runAliasToRunId.set(canonicalRunId, canonicalRunId);
  for (const alias of readAttributedRunIds(value)) {
    runAliasToRunId.set(alias, canonicalRunId);
  }
};

const parseToolUse = (segment: ReplySegment): ParsedToolUse | null => {
  const data = readObject(segment.data);
  const toolFunction = readObject(data?.function);
  const name = readString(toolFunction?.name);
  const callId = readString(data?.id);
  if (!name || !callId) {
    return null;
  }

  return {
    name,
    callId,
    args: parseArguments(toolFunction?.arguments),
    attributedRunId: readAttributedRunId(data),
  };
};

const parseToolResult = (segment: ReplySegment): ParsedToolResult | null => {
  const data = readObject(segment.data);
  const toolCall = readObject(data?.toolCall);
  const toolFunction = readObject(toolCall?.function);
  const result = readObject(data?.result);
  const resultData = readObject(result?.data);
  const name = readString(toolFunction?.name);
  const callId = readString(toolCall?.id);
  if (!name || !callId) {
    return null;
  }
  return {
    name,
    callId,
    success: result?.success !== false,
    payload: readObject(resultData?.payload) ?? resultData,
    output: readString(resultData?.output),
    summary: readString(resultData?.summary),
    error: readString(result?.error),
    attributedRunId:
      readAttributedRunId(toolCall) ?? readAttributedRunId(resultData) ?? readAttributedRunId(result),
  };
};

const parseToolStream = (segment: ReplySegment): ParsedToolStream | null => {
  const match = segment.id.match(/:tool:([^:]+):(stdout|stderr)$/);
  if (!match?.[1]) {
    return null;
  }

  return {
    callId: match[1],
    attributedRunId: readAttributedRunId(segment.data),
  };
};

const createAccumulator = (
  runId: string,
  seed: {
    title: string;
    role?: string;
    status: SubagentRunStatus;
    progress?: number;
    linkedTaskId?: string | null;
    outputPreview?: string;
    finalSummary?: string;
    firstSeenIndex: number;
    updatedAt: number;
  }
): RunAccumulator => ({
  runId,
  title: seed.title,
  role: seed.role,
  status: seed.status,
  progress: seed.progress,
  linkedTaskId: seed.linkedTaskId,
  latestStatusLine: undefined,
  highlights: [],
  artifacts: seed.outputPreview
    ? [{ id: `${runId}:artifact:final-output`, label: 'final output', content: seed.outputPreview }]
    : [],
  timeline: [],
  outputPreview: seed.outputPreview,
  finalSummary: seed.finalSummary,
  firstSeenIndex: seed.firstSeenIndex,
  updatedAt: seed.updatedAt,
  hiddenToolCallIds: [],
});

const addTimeline = (
  run: RunAccumulator,
  kind: SubagentRunTimelineEntry['kind'],
  text: string,
  timestamp: number
) => {
  run.timeline.push({
    id: `${run.runId}:${kind}:${run.timeline.length + 1}`,
    kind,
    text,
    timestamp,
  });
};

const addHighlight = (
  run: RunAccumulator,
  kind: SubagentRunHighlight['kind'],
  text: string,
  timestamp: number
) => {
  run.highlights.push({
    id: `${run.runId}:${kind}:${run.highlights.length + 1}`,
    kind,
    text,
    timestamp,
  });
};

const upsertRun = (
  runsById: Map<string, RunAccumulator>,
  runId: string,
  patch: {
    title?: string;
    role?: string;
    status?: SubagentRunStatus;
    progress?: number;
    linkedTaskId?: string | null;
    outputPreview?: string;
    finalSummary?: string;
    timestamp: number;
    firstSeenIndex?: number;
    lifecycleText?: string;
    highlightText?: string;
    highlightKind?: SubagentRunHighlight['kind'];
  }
): RunAccumulator => {
  const existing = runsById.get(runId);
  const next =
    existing ??
    createAccumulator(runId, {
      title: patch.title ?? runId,
      role: patch.role,
      status: patch.status ?? 'running',
      progress: patch.progress,
      linkedTaskId: patch.linkedTaskId,
      outputPreview: patch.outputPreview,
      finalSummary: patch.finalSummary,
      firstSeenIndex: patch.firstSeenIndex ?? patch.timestamp,
      updatedAt: patch.timestamp,
    });

  if (patch.title) next.title = patch.title;
  if (patch.role) next.role = patch.role;
  if (patch.status) next.status = patch.status;
  if (patch.progress !== undefined) next.progress = patch.progress;
  if (patch.linkedTaskId !== undefined) next.linkedTaskId = patch.linkedTaskId;
  if (patch.outputPreview?.trim()) {
    next.outputPreview = patch.outputPreview;
    const existingArtifact = next.artifacts.find((artifact) => artifact.label === 'final output');
    if (existingArtifact) {
      existingArtifact.content = patch.outputPreview;
    } else {
      next.artifacts.push({
        id: `${runId}:artifact:final-output`,
        label: 'final output',
        content: patch.outputPreview,
      });
    }
  }
  if (patch.finalSummary?.trim()) {
    next.finalSummary = patch.finalSummary;
    const existingSummaryArtifact = next.artifacts.find((artifact) => artifact.label === 'summary');
    if (existingSummaryArtifact) {
      existingSummaryArtifact.content = patch.finalSummary;
    } else {
      next.artifacts.unshift({
        id: `${runId}:artifact:summary`,
        label: 'summary',
        content: patch.finalSummary,
      });
    }
  }
  if (patch.firstSeenIndex !== undefined) {
    next.firstSeenIndex = Math.min(next.firstSeenIndex, patch.firstSeenIndex);
  }
  next.updatedAt = Math.max(next.updatedAt, patch.timestamp);

  if (patch.lifecycleText) {
    addTimeline(next, 'lifecycle', patch.lifecycleText, patch.timestamp);
  }
  if (patch.highlightText && patch.highlightKind) {
    if (patch.highlightKind === 'status') {
      next.latestStatusLine = patch.highlightText;
    }
    addHighlight(next, patch.highlightKind, patch.highlightText, patch.timestamp);
    addTimeline(
      next,
      patch.highlightKind === 'insight'
        ? 'insight'
        : patch.highlightKind === 'warning'
          ? 'warning'
          : patch.highlightKind === 'error'
            ? 'error'
            : 'status',
      patch.highlightText,
      patch.timestamp
    );
  }

  runsById.set(runId, next);
  return next;
};

const readRunRecord = (payload: Record<string, unknown> | null): Record<string, unknown> | null => {
  if (!payload) {
    return null;
  }
  return readObject(payload.agentRun) ?? payload;
};

const buildRunPatch = (
  record: Record<string, unknown>,
  fallbackTitle: string,
  timestamp: number
) => ({
  title: readString(record.description) ?? fallbackTitle,
  role: readString(record.role) ?? readString(record.subagentType),
  status: asStatus(record.status),
  progress: readNumber(record.progress),
  linkedTaskId: readString(record.linkedTaskId) ?? null,
  outputPreview: readString(record.output),
  finalSummary: readString(record.summary) ?? readString(record.finalSummary),
  timestamp,
  firstSeenIndex: timestamp,
});

const isSubagentTool = (name: string): boolean => {
  return (
    name === 'spawn_agent' ||
    name === 'agent_status' ||
    name === 'wait_agents' ||
    name === 'cancel_agent' ||
    name === 'task_output'
  );
};

export const buildReplyRunProjection = (segments: ReplySegment[]): ReplyRunProjection => {
  const toolUses = new Map<string, ParsedToolUse>();
  const toolAttributionByCallId = new Map<string, string>();
  const runsById = new Map<string, RunAccumulator>();
  const runAliasToRunId = new Map<string, string>();
  const hiddenToolCallIds = new Set<string>();

  segments.forEach((segment, index) => {
    const timestamp = index + 1;
    if (segment.id.startsWith('1:tool-use:') || segment.id.includes(':tool-use:')) {
      const parsedUse = parseToolUse(segment);
      if (parsedUse) {
        toolUses.set(parsedUse.callId, parsedUse);
        if (parsedUse.attributedRunId) {
          toolAttributionByCallId.set(parsedUse.callId, parsedUse.attributedRunId);
        }
        if (isSubagentTool(parsedUse.name)) {
          hiddenToolCallIds.add(parsedUse.callId);
        }
      }
      return;
    }

    if (segment.id.startsWith('1:tool:') || segment.id.includes(':tool:')) {
      const parsedStream = parseToolStream(segment);
      if (parsedStream?.attributedRunId) {
        toolAttributionByCallId.set(parsedStream.callId, parsedStream.attributedRunId);
      }
      return;
    }

    if (!segment.id.startsWith('1:tool-result:') && !segment.id.includes(':tool-result:')) {
      return;
    }

    const parsedResult = parseToolResult(segment);
    if (!parsedResult) {
      return;
    }
    if (parsedResult.attributedRunId) {
      toolAttributionByCallId.set(parsedResult.callId, parsedResult.attributedRunId);
    }
    if (!isSubagentTool(parsedResult.name)) {
      return;
    }

    const parsedUse = toolUses.get(parsedResult.callId);
    const payload = parsedResult.payload ?? null;

    if (parsedResult.name === 'spawn_agent') {
      const record = readRunRecord(payload);
      const runId = resolveCanonicalRunId(runAliasToRunId, record);
      if (!runId) {
        return;
      }
      registerRunAliases(runAliasToRunId, runId, record);
      const run = upsertRun(
        runsById,
        runId,
        {
          ...buildRunPatch(
            record ?? {},
            readString(parsedUse?.args?.description) ?? 'subagent run',
            timestamp
          ),
          lifecycleText: 'spawned',
          highlightText: `started ${readString(record?.description) ?? readString(parsedUse?.args?.description) ?? runId}`,
          highlightKind: 'status',
        }
      );
      run.hiddenToolCallIds.push(parsedResult.callId);
      hiddenToolCallIds.add(parsedResult.callId);
      return;
    }

    if (parsedResult.name === 'agent_status' || parsedResult.name === 'cancel_agent' || parsedResult.name === 'task_output') {
      const record = readRunRecord(payload);
      const runId = resolveCanonicalRunId(runAliasToRunId, record);
      if (!runId) {
        return;
      }
      registerRunAliases(runAliasToRunId, runId, record);
      const run = upsertRun(runsById, runId, {
        ...buildRunPatch(record ?? {}, readString(record?.description) ?? runId, timestamp),
        lifecycleText: parsedResult.name === 'cancel_agent' ? 'cancel requested' : 'status updated',
        highlightText:
          parsedResult.name === 'cancel_agent'
            ? readString(record?.error) ?? 'run cancelled'
            : readString(record?.output)
              ? truncate(readString(record?.output) ?? '')
              : `status ${readString(record?.status) ?? 'updated'}`,
        highlightKind:
          parsedResult.name === 'cancel_agent'
            ? 'warning'
            : readString(record?.output)
              ? 'status'
              : 'status',
      });
      run.hiddenToolCallIds.push(parsedResult.callId);
      hiddenToolCallIds.add(parsedResult.callId);
      return;
    }

    if (parsedResult.name === 'wait_agents') {
      const records = readArray(payload?.records)
        .map((item) => readObject(item))
        .filter((item): item is Record<string, unknown> => Boolean(item));
      records.forEach((record) => {
        const runId = resolveCanonicalRunId(runAliasToRunId, record);
        if (!runId) {
          return;
        }
        registerRunAliases(runAliasToRunId, runId, record);
        const statusOutput = readString(record.output);
        const run = upsertRun(runsById, runId, {
          ...buildRunPatch(record, readString(record.description) ?? runId, timestamp),
          lifecycleText: 'wait resolved',
          highlightText: statusOutput
            ? truncate(statusOutput)
            : `status ${readString(record.status) ?? 'updated'}`,
          highlightKind: 'status',
        });
        if (statusOutput) {
          addHighlight(run, 'insight', truncate(statusOutput), timestamp);
          addTimeline(run, 'insight', truncate(statusOutput), timestamp);
        }
        run.hiddenToolCallIds.push(parsedResult.callId);
      });
      hiddenToolCallIds.add(parsedResult.callId);
    }
  });

  for (const [toolCallId, attributedRunId] of toolAttributionByCallId) {
    const resolvedRunId = runAliasToRunId.get(attributedRunId) ?? attributedRunId;
    const run = runsById.get(resolvedRunId);
    if (!run) {
      continue;
    }
    if (!run.hiddenToolCallIds.includes(toolCallId)) {
      run.hiddenToolCallIds.push(toolCallId);
    }
    hiddenToolCallIds.add(toolCallId);
  }

  return {
    runs: [...runsById.values()]
      .sort((left, right) => {
        if (left.firstSeenIndex !== right.firstSeenIndex) {
          return left.firstSeenIndex - right.firstSeenIndex;
        }
        return right.updatedAt - left.updatedAt;
      })
      .map((run) => ({
        runId: run.runId,
        title: run.title,
        role: run.role,
        status: run.status,
        statusText: run.status.replace(/_/g, ' '),
        progress: run.progress,
        linkedTaskId: run.linkedTaskId,
        latestStatusLine: run.latestStatusLine,
        highlights: run.highlights.slice(-3),
        artifacts: run.artifacts,
        timeline: run.timeline,
        outputPreview: run.outputPreview,
        finalSummary: run.finalSummary,
        firstSeenIndex: run.firstSeenIndex,
        updatedAt: run.updatedAt,
      })),
    hiddenToolCallIds: [...hiddenToolCallIds],
  };
};

export const buildConversationRunProjections = (turns: ChatTurn[]): SubagentRunViewModel[] => {
  const merged = new Map<string, SubagentRunViewModel>();

  for (const turn of turns) {
    const reply = turn.reply;
    if (!reply) {
      continue;
    }
    const projection = buildReplyRunProjection(reply.segments);
    for (const run of projection.runs) {
      const existing = merged.get(run.runId);
      if (!existing || existing.updatedAt <= run.updatedAt) {
        merged.set(run.runId, run);
      }
    }
  }

  return [...merged.values()].sort((left, right) => {
    if (left.firstSeenIndex !== right.firstSeenIndex) {
      return left.firstSeenIndex - right.firstSeenIndex;
    }
    return right.updatedAt - left.updatedAt;
  });
};
