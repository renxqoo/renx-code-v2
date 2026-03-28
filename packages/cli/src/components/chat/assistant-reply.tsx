import { useEffect, useMemo, useState } from 'react';

import { buildReplyRunProjection } from '../../hooks/subagent-runs';
import type { AssistantReply as AssistantReplyType, ReplySegment } from '../../types/chat';
import type { SubagentRunViewModel } from '../../types/subagent-run';
import { uiTheme } from '../../ui/theme';
import { AssistantSegment } from './assistant-segment';
import { AssistantToolGroup } from './assistant-tool-group';
import { RunCard } from './run-card';
import { buildReplyRenderItems } from './segment-groups';

const ERROR_RAIL_COLOR = '#dc2626';
const ERROR_TEXT_COLOR = '#c2410c';

type AssistantReplyProps = {
  reply: AssistantReplyType;
  activeRuns?: SubagentRunViewModel[];
};

export type AssistantReplyUsageItem = {
  icon: '↓' | '↑';
  value: string;
};

const renderStatus = (status: AssistantReplyType['status']) => {
  if (status === 'streaming') {
    return 'streaming';
  }
  if (status === 'error') {
    return 'error';
  }
  return undefined;
};

const formatDurationSeconds = (reply: AssistantReplyType, nowMs: number): string => {
  if (reply.status !== 'streaming') {
    return reply.durationSeconds.toFixed(1);
  }
  if (typeof reply.startedAtMs !== 'number') {
    return reply.durationSeconds.toFixed(1);
  }
  const elapsedSeconds = Math.max(0, (nowMs - reply.startedAtMs) / 1000);
  return Math.max(reply.durationSeconds, elapsedSeconds).toFixed(1);
};

const formatTokenCount = (tokens: number): string => {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  return `${(tokens / 1_000).toFixed(2)}k`;
};

const normalizeUsageTokens = (tokens: number | undefined): string | undefined => {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens)) {
    return undefined;
  }
  return formatTokenCount(Math.max(0, Math.round(tokens)));
};

export const buildUsageItems = (
  reply: Pick<AssistantReplyType, 'usagePromptTokens' | 'usageCompletionTokens'>
): AssistantReplyUsageItem[] => {
  const items: AssistantReplyUsageItem[] = [];
  const promptTokens = normalizeUsageTokens(reply.usagePromptTokens);
  const completionTokens = normalizeUsageTokens(reply.usageCompletionTokens);

  if (promptTokens) {
    items.push({ icon: '↑', value: promptTokens });
  }
  if (completionTokens) {
    items.push({ icon: '↓', value: completionTokens });
  }

  return items;
};

export const getCompletionErrorMessage = (reply: AssistantReplyType): string | undefined => {
  if (reply.status !== 'error' && reply.completionReason !== 'error') {
    return undefined;
  }

  const message = reply.completionMessage?.trim();
  return message ? message : undefined;
};

type InlineReplyItem =
  | { type: 'run'; run: ReturnType<typeof buildReplyRunProjection>['runs'][number] }
  | { type: 'tool'; group: Extract<ReturnType<typeof buildReplyRenderItems>[number], { type: 'tool' }>['group'] }
  | { type: 'segment'; segment: ReplySegment };

const buildInlineReplyItems = (
  items: ReturnType<typeof buildReplyRenderItems>,
  runs: ReturnType<typeof buildReplyRunProjection>['runs']
): InlineReplyItem[] => {
  if (items.length === 0) {
    return runs.map((run) => ({ type: 'run' as const, run }));
  }

  const runBuckets = new Map<number, typeof runs>();
  runs.forEach((run) => {
    const bucket = runBuckets.get(run.firstSeenIndex) ?? [];
    bucket.push(run);
    runBuckets.set(run.firstSeenIndex, bucket);
  });

  const inlineItems: InlineReplyItem[] = [];

  items.forEach((item, index) => {
    const bucket = runBuckets.get(index + 1) ?? [];
    bucket.forEach((run) => inlineItems.push({ type: 'run', run }));
    inlineItems.push(item as InlineReplyItem);
  });

  const trailingRuns = runs.filter((run) => run.firstSeenIndex > items.length || run.firstSeenIndex <= 0);
  trailingRuns.forEach((run) => inlineItems.push({ type: 'run', run }));

  return inlineItems;
};

const mergeVisibleRuns = (
  localRuns: ReturnType<typeof buildReplyRunProjection>['runs'],
  activeRuns: SubagentRunViewModel[] | undefined
): ReturnType<typeof buildReplyRunProjection>['runs'] => {
  if (!activeRuns || activeRuns.length === 0) {
    return localRuns;
  }

  const merged = new Map<string, SubagentRunViewModel>();
  for (const run of activeRuns) {
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled' || run.status === 'timed_out') {
      continue;
    }
    merged.set(run.runId, run);
  }
  for (const run of localRuns) {
    const existing = merged.get(run.runId);
    if (!existing || existing.updatedAt <= run.updatedAt) {
      merged.set(run.runId, run);
    }
  }

  return [...merged.values()].sort((left, right) => {
    if (left.firstSeenIndex !== right.firstSeenIndex) {
      return left.firstSeenIndex - right.firstSeenIndex;
    }
    return right.updatedAt - left.updatedAt;
  });
};

export const AssistantReply = ({ reply, activeRuns }: AssistantReplyProps) => {
  const status = renderStatus(reply.status);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const runProjection = buildReplyRunProjection(reply.segments);
  const runs = mergeVisibleRuns(reply.runProjections ?? runProjection.runs, activeRuns);
  const hiddenToolCallIds = new Set(reply.hiddenToolCallIds ?? runProjection.hiddenToolCallIds);
  const items = buildReplyRenderItems(reply.segments);
  const visibleItems = items.filter((item) => {
    if (item.type !== 'tool') {
      return true;
    }
    return !hiddenToolCallIds.has(item.group.toolCallId);
  });
  const isStreaming = reply.status === 'streaming';
  const inlineItems = useMemo(() => buildInlineReplyItems(visibleItems, runs), [visibleItems, runs]);

  useEffect(() => {
    if (reply.status !== 'streaming') {
      return;
    }
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 100);
    return () => {
      clearInterval(timer);
    };
  }, [reply.status]);

  const durationText = formatDurationSeconds(reply, nowMs);
  const usageItems = buildUsageItems(reply);
  const completionErrorMessage = getCompletionErrorMessage(reply);

  return (
    <box flexDirection="column" gap={1}>
      {inlineItems.map((item, index) =>
        item.type === 'run' ? (
          <RunCard key={`run:${item.run.runId}:${index}`} run={item.run} />
        ) : item.type === 'tool' ? (
          <AssistantToolGroup
            key={`tool-group:${item.group.toolCallId}:${index}`}
            group={item.group}
          />
        ) : (
          <AssistantSegment key={item.segment.id} segment={item.segment} streaming={isStreaming} />
        )
      )}
      {completionErrorMessage ? (
        <box flexDirection="row">
          <box
            border={['left']}
            borderColor={ERROR_RAIL_COLOR}
            customBorderChars={{
              topLeft: '',
              topRight: '',
              bottomRight: '',
              horizontal: ' ',
              bottomT: '',
              topT: '',
              cross: '',
              leftT: '',
              rightT: '',
              vertical: '┃',
              bottomLeft: '╹',
            }}
          />
          <box backgroundColor={uiTheme.surface} paddingX={2} paddingY={1} flexGrow={1}>
            <text fg={ERROR_TEXT_COLOR} attributes={uiTheme.typography.body} wrapMode="word">
              {completionErrorMessage}
            </text>
          </box>
        </box>
      ) : null}
      <box flexDirection="row" gap={1} paddingLeft={3}>
        <text fg={uiTheme.muted} attributes={uiTheme.typography.muted}>
          <span fg={uiTheme.accent}>▣</span> assistant
          <span fg={uiTheme.muted}> · {reply.modelLabel}</span>
          <span fg={uiTheme.muted}> · {durationText}s</span>
          {usageItems.map((item) => (
            <span key={`${item.icon}:${item.value}`} fg={uiTheme.muted}>
              {' · '}
              {item.icon} {item.value}
            </span>
          ))}
          {status ? <span fg={uiTheme.muted}> · {status}</span> : null}
        </text>
      </box>
    </box>
  );
};
