import type { RenderNodeContext, Renderable } from '@opentui/core';
import type { Token } from 'marked';

import type { ReplySegment } from '../../types/chat';
import { opencodeMarkdownSyntax, opencodeSubtleMarkdownSyntax } from '../../ui/opencode-markdown';
import { MESSAGE_RAIL_BORDER_CHARS, uiTheme } from '../../ui/theme';
import { readReplySourceMeta } from '../../utils/reply-source';
import { CodeBlock } from './code-block';

type AssistantSegmentProps = {
  segment: ReplySegment;
  streaming: boolean;
};

const markdownTableOptions = {
  widthMode: 'full' as const,
  wrapMode: 'word' as const,
  selectable: true,
};

type TextBufferRenderableLike = Renderable & {
  fg?: string;
  bg?: string;
  selectionBg?: string;
  selectionFg?: string;
};

const patchMarkdownCodeBlockRenderable = (
  token: Token,
  context: RenderNodeContext
): Renderable | null => {
  const renderable = context.defaultRender();
  if (!renderable || token.type !== 'code') {
    return renderable;
  }

  const textBufferRenderable = renderable as TextBufferRenderableLike;
  textBufferRenderable.fg = uiTheme.text;
  textBufferRenderable.bg = uiTheme.codeBlock.bg;
  textBufferRenderable.selectionBg = uiTheme.codeBlock.selectionBg;
  textBufferRenderable.selectionFg = uiTheme.codeBlock.selectionText;

  return renderable;
};

const ThinkingSegment = ({ content, streaming }: { content: string; streaming: boolean }) => {
  const normalized = content.trim();
  if (!normalized) {
    return null;
  }

  return (
    <box flexDirection="row">
      <box
        border={['left']}
        borderColor={uiTheme.divider}
        customBorderChars={MESSAGE_RAIL_BORDER_CHARS}
      />
      <box flexGrow={1} paddingLeft={2}>
        <markdown
          streaming={streaming}
          syntaxStyle={opencodeSubtleMarkdownSyntax}
          content={`_Thinking:_ ${normalized}`}
          conceal={true}
          renderNode={patchMarkdownCodeBlockRenderable}
          tableOptions={markdownTableOptions}
        />
      </box>
    </box>
  );
};

const CodeSegment = ({ content, languageHint }: { content: string; languageHint?: string }) => {
  return (
    <box>
      <CodeBlock content={content} languageHint={languageHint} />
    </box>
  );
};

const readSegmentLanguageHint = (data: unknown): string | undefined => {
  if (!data || typeof data !== 'object' || !('languageHint' in data)) {
    return undefined;
  }

  const languageHint = (data as { languageHint?: unknown }).languageHint;
  return typeof languageHint === 'string' ? languageHint : undefined;
};

const TextSegment = ({ content, streaming }: { content: string; streaming: boolean }) => {
  const normalized = content.trim();
  if (!normalized) {
    return null;
  }

  return (
    <box paddingLeft={3}>
      <markdown
        streaming={streaming}
        syntaxStyle={opencodeMarkdownSyntax}
        content={normalized}
        conceal={true}
        renderNode={patchMarkdownCodeBlockRenderable}
        tableOptions={markdownTableOptions}
      />
    </box>
  );
};

const SourceHeader = ({
  label,
  detail,
  callId,
}: {
  label: string;
  detail?: string;
  callId?: string;
}) => {
  return (
    <box paddingLeft={3} paddingBottom={1} flexDirection="column">
      <text fg={uiTheme.muted} attributes={uiTheme.typography.note}>
        {label}
      </text>
      {detail ? (
        <text fg={uiTheme.subtle} attributes={uiTheme.typography.note}>
          {detail}
        </text>
      ) : null}
      {callId ? (
        <text fg={uiTheme.subtle} attributes={uiTheme.typography.note}>
          {`spawn call: ${callId}`}
        </text>
      ) : null}
    </box>
  );
};

export const AssistantSegment = ({ segment, streaming }: AssistantSegmentProps) => {
  const sourceMeta = readReplySourceMeta(segment.data);
  const sourceHeader =
    sourceMeta?.isSubagent && sourceMeta.showSourceHeader && sourceMeta.sourceLabel ? (
      <SourceHeader
        label={sourceMeta.sourceLabel}
        detail={sourceMeta.spawnedByLabel}
        callId={sourceMeta.spawnToolCallId}
      />
    ) : null;

  if (segment.type === 'thinking') {
    return (
      <box flexDirection="column">
        {sourceHeader}
        <ThinkingSegment content={segment.content} streaming={streaming} />
      </box>
    );
  }

  if (segment.type === 'code') {
    return (
      <box flexDirection="column">
        {sourceHeader}
        <CodeSegment
          content={segment.content}
          languageHint={readSegmentLanguageHint(segment.data)}
        />
      </box>
    );
  }

  // if (segment.type === 'note') {
  //   return <NoteSegment content={segment.content} />;
  // }

  return (
    <box flexDirection="column">
      {sourceHeader}
      <TextSegment content={segment.content} streaming={streaming} />
    </box>
  );
};
