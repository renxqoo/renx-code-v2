import type { ReplySegment } from '../../types/chat';
import type { ReplySourceMeta } from '../../utils/reply-source';
import { readReplySourceMeta } from '../../utils/reply-source';

type ToolSegmentKind = 'use' | 'stream' | 'result';

export type ToolSegmentMeta = {
  kind: ToolSegmentKind;
  toolCallId: string;
  channel?: 'stdout' | 'stderr';
};

export type ToolSegmentGroup = {
  toolCallId: string;
  use?: ReplySegment;
  streams: ReplySegment[];
  result?: ReplySegment;
  source?: ReplySourceMeta;
};

export type ReplyRenderItem =
  | {
      type: 'segment';
      segment: ReplySegment;
    }
  | {
      type: 'tool';
      group: ToolSegmentGroup;
    };

export const parseToolSegmentMeta = (segmentId: string): ToolSegmentMeta | null => {
  const toolUseMatch = segmentId.match(/^\d+:tool-use:(.+)$/);
  if (toolUseMatch && toolUseMatch[1]) {
    return {
      kind: 'use',
      toolCallId: toolUseMatch[1],
    };
  }

  const toolResultMatch = segmentId.match(/^\d+:tool-result:(.+)$/);
  if (toolResultMatch && toolResultMatch[1]) {
    return {
      kind: 'result',
      toolCallId: toolResultMatch[1],
    };
  }

  const toolStreamMatch = segmentId.match(/^\d+:tool:([^:]+):(stdout|stderr)$/);
  if (toolStreamMatch && toolStreamMatch[1] && toolStreamMatch[2]) {
    return {
      kind: 'stream',
      toolCallId: toolStreamMatch[1],
      channel: toolStreamMatch[2] as 'stdout' | 'stderr',
    };
  }

  return null;
};

export const buildReplyRenderItems = (segments: ReplySegment[]): ReplyRenderItem[] => {
  const items: ReplyRenderItem[] = [];
  let activeGroup: ToolSegmentGroup | null = null;

  const readSourceMergeKey = (segment: ReplySegment): string => {
    const sourceMeta = readReplySourceMeta(segment.data);
    return sourceMeta?.sourceKey ?? '';
  };

  const appendPlainSegment = (segment: ReplySegment) => {
    const previous = items[items.length - 1];
    if (
      previous?.type === 'segment' &&
      previous.segment.type === 'thinking' &&
      segment.type === 'thinking' &&
      readSourceMergeKey(previous.segment) === readSourceMergeKey(segment)
    ) {
      previous.segment = {
        ...previous.segment,
        content: `${previous.segment.content}${segment.content}`,
      };
      return;
    }

    items.push({
      type: 'segment',
      segment,
    });
  };

  const mergeGroupSource = (
    current: ReplySourceMeta | undefined,
    next: ReplySourceMeta | null
  ): ReplySourceMeta | undefined => {
    if (!next) {
      return current;
    }
    if (!current) {
      return next;
    }
    if (next.showSourceHeader) {
      return {
        ...current,
        ...next,
      };
    }
    return current;
  };

  const flushActiveGroup = () => {
    if (!activeGroup) {
      return;
    }
    items.push({
      type: 'tool',
      group: activeGroup,
    });
    activeGroup = null;
  };

  for (const segment of segments) {
    const meta = parseToolSegmentMeta(segment.id);
    if (!meta) {
      flushActiveGroup();
      appendPlainSegment(segment);
      continue;
    }

    if (!activeGroup || activeGroup.toolCallId !== meta.toolCallId) {
      flushActiveGroup();
      activeGroup = {
        toolCallId: meta.toolCallId,
        streams: [],
      };
    }

    activeGroup.source = mergeGroupSource(activeGroup.source, readReplySourceMeta(segment.data));

    if (meta.kind === 'use') {
      activeGroup.use = segment;
      continue;
    }

    if (meta.kind === 'result') {
      activeGroup.result = segment;
      continue;
    }

    activeGroup.streams.push(segment);
  }

  flushActiveGroup();
  return items;
};
