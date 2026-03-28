import { useEffect, useState } from 'react';

import { opencodeMarkdownSyntax } from '../../ui/opencode-markdown';
import { MESSAGE_RAIL_BORDER_CHARS, uiTheme } from '../../ui/theme';
import { getToolDisplayIcon, getToolDisplayName } from '../tool-display-config';
import { resolveToolResultFallbackText } from './assistant-tool-result';
import { CodeBlock, inferFiletypeFromPath, looksLikeDiff } from './code-block';
import { parseToolSegmentMeta, type ToolSegmentGroup } from './segment-groups';

const ERROR_RAIL_COLOR = '#dc2626';

type AssistantToolGroupProps = {
  group: ToolSegmentGroup;
};

type ParsedToolUse = {
  name: string;
  callId: string;
  command?: string;
  details?: string;
  args?: Record<string, unknown> | null;
};

type ParsedToolResult = {
  name: string;
  callId: string;
  status: 'success' | 'error' | 'unknown';
  details?: string;
  summary?: string;
  output?: string;
  payload?: unknown;
  metadata?: unknown;
  error?: string;
};

type ToolSection = {
  label?: string;
  content: string;
  tone?: 'body' | 'code';
  renderKind?: 'text' | 'code' | 'markdown';
  languageHint?: string;
  showLabel?: boolean;
  collapsible?: boolean;
};

type SpecialToolPresentation = {
  toolLabel?: string;
  headerDetail?: string;
  sections: ToolSection[];
};

const COLLAPSIBLE_OUTPUT_LINES = 16;
const COLLAPSIBLE_OUTPUT_LABELS = new Set(['output', 'error', 'result', 'details']);

const asObjectLike = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const parseToolArgumentsObject = (raw?: string): Record<string, unknown> | null => {
  if (!raw) {
    return null;
  }
  try {
    return asObjectLike(JSON.parse(raw));
  } catch {
    return null;
  }
};

const parseToolUseFromData = (value: unknown): ParsedToolUse | null => {
  const toolCall = asObjectLike(value);
  const toolFunction = asObjectLike(toolCall?.function);
  if (!toolFunction) {
    return null;
  }
  const name = typeof toolFunction.name === 'string' ? toolFunction.name : undefined;
  const callId = typeof toolCall?.id === 'string' ? toolCall.id : undefined;
  if (!name || !callId) {
    return null;
  }

  const rawArguments =
    typeof toolFunction.arguments === 'string' ? toolFunction.arguments : undefined;
  const args = parseToolArgumentsObject(rawArguments);
  const command =
    name === 'local_shell' && typeof args?.command === 'string' ? args.command : undefined;

  return {
    name,
    callId,
    command,
    details: rawArguments,
    args,
  };
};

const parseToolUse = (content?: string, data?: unknown): ParsedToolUse | null => {
  const structured = parseToolUseFromData(data);
  if (structured) {
    return structured;
  }
  if (!content) {
    return null;
  }
  const lines = content.split('\n');
  const header = lines[0]?.trim();
  if (!header) {
    return null;
  }
  const match = header.match(/^# Tool:\s+(.+?)\s+\(([^)]+)\)$/);
  if (!match || !match[1] || !match[2]) {
    return null;
  }

  const [_, name, callId] = match;
  const bodyLines = lines.slice(1);
  const commandLine = bodyLines.find((line) => line.trim().startsWith('$ '));
  const command = commandLine ? commandLine.trim().slice(2).trim() : undefined;
  const details = bodyLines
    .filter((line) => !line.trim().startsWith('$ '))
    .join('\n')
    .trim();

  return {
    name,
    callId,
    command: command || undefined,
    details: details || undefined,
    args: parseJsonObject(details),
  };
};

const parseToolResultFromData = (value: unknown): ParsedToolResult | null => {
  const event = asObjectLike(value);
  const toolCall = asObjectLike(event?.toolCall);
  const toolFunction = asObjectLike(toolCall?.function);
  const result = asObjectLike(event?.result);
  const data = asObjectLike(result?.data);
  const name = typeof toolFunction?.name === 'string' ? toolFunction.name : undefined;
  const callId = typeof toolCall?.id === 'string' ? toolCall.id : undefined;
  if (!name || !callId) {
    return null;
  }

  const successValue = result?.success;
  const status = successValue === true ? 'success' : successValue === false ? 'error' : 'unknown';
  const summary = typeof data?.summary === 'string' ? data.summary : undefined;
  const output = typeof data?.output === 'string' ? data.output : undefined;
  const error = typeof result?.error === 'string' ? result.error : undefined;

  return {
    name,
    callId,
    status,
    details: output || summary || error,
    summary,
    output,
    payload: data?.payload,
    metadata: data?.metadata,
    error,
  };
};

const parseToolResult = (content?: string, data?: unknown): ParsedToolResult | null => {
  const structured = parseToolResultFromData(data);
  if (structured) {
    return structured;
  }
  if (!content) {
    return null;
  }
  const lines = content.split('\n');
  const header = lines[0]?.trim();
  if (!header) {
    return null;
  }
  const match = header.match(/^# Result:\s+(.+?)\s+\(([^)]+)\)\s+(success|error)$/);
  if (!match || !match[1] || !match[2] || !match[3]) {
    return null;
  }

  const [_, name, callId, status] = match;
  const details = lines.slice(1).join('\n').trim();

  return {
    name,
    callId,
    status: status === 'success' || status === 'error' ? status : 'unknown',
    details: details || undefined,
    ...(status === 'error' ? { error: details || undefined } : {}),
  };
};

const resolveToolIcon = (toolName: string): string => {
  return getToolDisplayIcon(toolName);
};

const mergeOutputLines = (
  group: ToolSegmentGroup,
  parsedResult: ParsedToolResult | null
): string => {
  const streamText = group.streams
    .map((segment) => segment.content)
    .join('')
    .trim();
  const fallbackText = resolveToolResultFallbackText(parsedResult)?.trim();
  const resultText = parsedResult?.output?.trim() || parsedResult?.details?.trim() || fallbackText;
  if (streamText && resultText && streamText === resultText) {
    return streamText;
  }
  if (streamText && resultText) {
    return `${streamText}\n${resultText}`;
  }
  return streamText || resultText || parsedResult?.summary?.trim() || '';
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

const readBoolean = (value: unknown): boolean | undefined => {
  return typeof value === 'boolean' ? value : undefined;
};

const parseJsonObject = (content?: string): Record<string, unknown> | null => {
  if (!content) {
    return null;
  }
  try {
    return readObject(JSON.parse(content));
  } catch {
    return null;
  }
};

const parseJsonValue = (content?: string): unknown => {
  if (!content) {
    return undefined;
  }
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
};

const countEscapeMarkers = (value: string): number => {
  return (value.match(/\\r\\n|\\n|\\t|\\"|\\\\/g) ?? []).length;
};

const decodeEscapeSequencesOnce = (value: string): string => {
  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
};

const normalizeToolDisplayText = (value: string): string => {
  let current = value.replace(/\r\n/g, '\n').trimEnd();
  for (let index = 0; index < 2; index += 1) {
    const next = decodeEscapeSequencesOnce(current);
    if (countEscapeMarkers(next) >= countEscapeMarkers(current)) {
      break;
    }
    current = next;
  }

  const parsed = parseJsonValue(current);
  if (parsed !== undefined && typeof parsed !== 'string') {
    try {
      return JSON.stringify(parsed, null, 2);
    } catch {
      return current;
    }
  }

  return current;
};

const resolveSectionLanguageHint = (
  toolName: string,
  section: Pick<ToolSection, 'label' | 'tone' | 'languageHint'>
): string | undefined => {
  if (section.languageHint) {
    return section.languageHint;
  }
  if (section.tone !== 'code') {
    return undefined;
  }
  if (section.label === 'command') {
    return toolName === 'local_shell' ? 'bash' : undefined;
  }
  if (section.label === 'arguments') {
    return 'json';
  }
  return undefined;
};

const isCollapsibleResultSection = (section: ToolSection): boolean => {
  if (section.tone !== 'code') {
    return false;
  }

  if (section.collapsible === true) {
    return true;
  }

  const label = section.label?.toLowerCase();
  if (!label) {
    return false;
  }

  return COLLAPSIBLE_OUTPUT_LABELS.has(label);
};

const formatToolName = (toolName: string): string => {
  return getToolDisplayName(toolName);
};

const stripReadFileLinePrefixes = (value: string): string => {
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  let strippedCount = 0;
  const normalized = lines.map((line) => {
    const match = line.match(/^L\d+:\s?(.*)$/);
    if (!match) {
      return line;
    }
    strippedCount += 1;
    return match[1] ?? '';
  });
  return strippedCount > 0 ? normalized.join('\n') : value;
};

const getResultBodyText = (result: ParsedToolResult | null): string => {
  return (
    result?.output?.trim() ||
    result?.details?.trim() ||
    resolveToolResultFallbackText(result)?.trim() ||
    result?.summary?.trim() ||
    ''
  );
};

const countEditReplacements = (args: Record<string, unknown> | null): number => {
  return readArray(args?.edits).length;
};

const formatReplacementCount = (count: number): string | null => {
  if (count <= 0) {
    return null;
  }
  return `${count} replacement${count === 1 ? '' : 's'}`;
};

const FILE_EDIT_PREVIEW_LIMIT = 3;

const buildFileEditChangeSections = (args: Record<string, unknown> | null): ToolSection[] => {
  const edits = readArray(args?.edits)
    .map((item) => readObject(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
  if (edits.length === 0) {
    return [];
  }

  const languageHint = inferFiletypeFromPath(readString(args?.path)) ?? 'text';
  const sections = edits.slice(0, FILE_EDIT_PREVIEW_LIMIT).flatMap((edit, index) => {
    const changeLabel = `change ${index + 1}`;
    const oldText = readString(edit.oldText)?.trim();
    const newText = readString(edit.newText)?.trim();
    const changeSections: ToolSection[] = [
      {
        label: changeLabel,
        content: '',
        tone: 'body',
        renderKind: 'text',
        showLabel: true,
      },
    ];

    if (oldText) {
      changeSections.push({
        label: 'match',
        content: oldText,
        tone: 'code',
        renderKind: 'code',
        languageHint,
        showLabel: true,
        collapsible: true,
      });
    }
    if (newText) {
      changeSections.push({
        label: oldText ? 'replace with' : 'insert',
        content: newText,
        tone: 'code',
        renderKind: 'code',
        languageHint,
        showLabel: true,
        collapsible: true,
      });
    }
    if (changeSections.length === 1) {
      changeSections.push({
        label: 'update',
        content: 'replace text',
        tone: 'body',
        renderKind: 'text',
        showLabel: true,
      });
    }

    return changeSections;
  });

  if (edits.length > FILE_EDIT_PREVIEW_LIMIT) {
    const hiddenCount = edits.length - FILE_EDIT_PREVIEW_LIMIT;
    sections.push({
      label: 'changes',
      content: `+${hiddenCount} more change${hiddenCount === 1 ? '' : 's'} not shown`,
      tone: 'body',
      renderKind: 'text',
      showLabel: true,
    });
  }

  return sections;
};

const inferShellStreamSection = (label: 'stdout' | 'stderr', content: string): ToolSection => {
  const normalized = normalizeToolDisplayText(content);
  if (looksLikeDiff(normalized)) {
    return {
      label,
      content: normalized,
      tone: 'code',
      renderKind: 'code',
      languageHint: 'diff',
      showLabel: true,
    };
  }

  const trimmed = normalized.trim();
  const shellTranscript = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const looksLikeShellTranscript =
    shellTranscript.length > 0 && shellTranscript.every((line) => line.startsWith('$ '));
  const looksLikeJson =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'));
  const isErrorLikeStderr =
    label === 'stderr' &&
    /(\berror\b|exception|traceback|cannot find module|failed|enoent|eacces|syntaxerror|typeerror)/i.test(
      trimmed
    );

  if (looksLikeJson) {
    try {
      JSON.parse(trimmed);
      return {
        label,
        content: normalized,
        tone: 'code',
        renderKind: 'code',
        languageHint: 'json',
        showLabel: true,
      };
    } catch {
      // fall through
    }
  }

  if (looksLikeShellTranscript) {
    return {
      label,
      content: normalized,
      tone: 'code',
      renderKind: 'code',
      languageHint: 'bash',
      showLabel: true,
    };
  }

  if (isErrorLikeStderr) {
    return {
      label: 'stderr error',
      content: normalized,
      tone: 'code',
      renderKind: 'code',
      languageHint: 'text',
      showLabel: true,
    };
  }

  return {
    label,
    content: normalized,
    tone: 'body',
    renderKind: 'text',
    showLabel: true,
  };
};

const buildReadFilePresentation = (
  args: Record<string, unknown> | null,
  result: ParsedToolResult | null
): SpecialToolPresentation | null => {
  const path = readString(args?.path);
  const mode = readString(args?.mode) ?? 'text';
  const content = getResultBodyText(result);
  if (!content) {
    return null;
  }

  if (mode === 'image') {
    return {
      toolLabel: formatToolName('read_file'),
      headerDetail: path,
      sections: [
        {
          label: 'result',
          content,
          tone: 'body',
          renderKind: 'text',
        },
      ],
    };
  }

  const filetype = inferFiletypeFromPath(path);
  const normalized = stripReadFileLinePrefixes(normalizeToolDisplayText(content));
  const markdownLike = filetype === 'markdown';
  const isCode = Boolean(filetype && filetype !== 'markdown' && filetype !== 'text');

  return {
    toolLabel: formatToolName('read_file'),
    headerDetail: path,
    sections: markdownLike
      ? [
          {
            label: 'raw',
            content: normalized,
            tone: 'code',
            renderKind: 'code',
            languageHint: 'markdown',
            showLabel: true,
          },
          {
            label: 'preview',
            content: normalized,
            tone: 'body',
            renderKind: 'markdown',
            showLabel: true,
          },
        ]
      : [
          {
            label: 'content',
            content: normalized,
            tone: 'code',
            renderKind: 'code',
            languageHint: isCode ? filetype : 'text',
            showLabel: true,
          },
        ],
  };
};

const buildFileEditPresentation = (
  args: Record<string, unknown> | null,
  result: ParsedToolResult | null
): SpecialToolPresentation => {
  const path = readString(args?.path);
  const replacementCount = countEditReplacements(args);
  const headerDetail = formatSummaryMeta([
    path,
    readBoolean(args?.dryRun) ? 'dry run' : 'applied',
    formatReplacementCount(replacementCount),
  ]);
  const bodyText = getResultBodyText(result);
  const isDiff = looksLikeDiff(bodyText);
  const sections: ToolSection[] = [];

  if (result?.summary?.trim()) {
    sections.push({
      label: 'result',
      content: result.summary.trim(),
      tone: 'body',
      renderKind: 'text',
      showLabel: true,
    });
  }

  const changeSections = buildFileEditChangeSections(args);
  if (changeSections.length > 0 && !isDiff) {
    sections.push(...changeSections);
  }

  if (bodyText) {
    sections.push({
      label: isDiff ? 'diff' : result?.status === 'error' ? 'error' : 'output',
      content: bodyText,
      tone: isDiff ? 'code' : 'body',
      renderKind: isDiff ? 'code' : 'text',
      languageHint: isDiff ? 'diff' : undefined,
      showLabel: !isDiff,
      collapsible: false,
    });
  }

  return {
    toolLabel: formatToolName('file_edit'),
    headerDetail: headerDetail ?? undefined,
    sections,
  };
};

const buildLocalShellPresentation = (
  group: ToolSegmentGroup,
  args: Record<string, unknown> | null,
  result: ParsedToolResult | null
): SpecialToolPresentation => {
  const stdout = group.streams
    .filter((segment) => parseToolSegmentMeta(segment.id)?.channel === 'stdout')
    .map((segment) => segment.content)
    .join('')
    .trim();
  const stderr = group.streams
    .filter((segment) => parseToolSegmentMeta(segment.id)?.channel === 'stderr')
    .map((segment) => segment.content)
    .join('')
    .trim();
  const metadata = readObject(result?.metadata) ?? readObject(result?.payload);
  const sections: ToolSection[] = [];

  if (stdout) {
    sections.push(inferShellStreamSection('stdout', stdout));
  }
  if (stderr) {
    sections.push(inferShellStreamSection('stderr', stderr));
  }
  if (sections.length === 0) {
    const bodyText = getResultBodyText(result);
    if (bodyText) {
      sections.push({
        label: result?.status === 'error' ? 'error' : 'output',
        content: bodyText,
        tone: 'code',
        renderKind: 'code',
      });
    }
  }

  const headerDetail = formatSummaryMeta([
    readString(args?.workdir),
    readNumber(metadata?.exitCode) !== undefined ? `exit ${readNumber(metadata?.exitCode)}` : null,
  ]);

  return {
    toolLabel: formatToolName('local_shell'),
    headerDetail: headerDetail ?? undefined,
    sections,
  };
};

const truncate = (value: string, maxLength = 88): string => {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
};

const compactDetail = (value?: string, maxLength = 72): string | null => {
  if (!value) {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return null;
  }
  return truncate(normalized, maxLength);
};

const formatSummaryMeta = (parts: Array<string | null | undefined>): string | null => {
  const filtered = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return filtered.length > 0 ? filtered.join(' · ') : null;
};

const buildSearchHeaderDetail = (
  toolName: string,
  args: Record<string, unknown> | null
): string | null => {
  if (!args) {
    return null;
  }

  if (toolName === 'grep') {
    const pattern = readString(args.pattern);
    if (!pattern) {
      return null;
    }

    return formatSummaryMeta([
      JSON.stringify(pattern),
      readString(args.path) ? `in ${readString(args.path)}` : null,
      readString(args.glob) ? `glob ${readString(args.glob)}` : null,
      readNumber(args.maxResults) !== undefined
        ? `limit ${Math.round(readNumber(args.maxResults) ?? 0)}`
        : null,
      readNumber(args.timeoutMs) !== undefined
        ? `${Math.round((readNumber(args.timeoutMs) ?? 0) / 1000)}s timeout`
        : null,
    ]);
  }

  if (toolName === 'glob') {
    const pattern = readString(args.pattern);
    if (!pattern) {
      return null;
    }

    return formatSummaryMeta([
      pattern,
      readString(args.path) ? `in ${readString(args.path)}` : null,
      readBoolean(args.includeHidden) ? 'include hidden' : null,
      readNumber(args.maxResults) !== undefined
        ? `limit ${Math.round(readNumber(args.maxResults) ?? 0)}`
        : null,
    ]);
  }

  return null;
};

const buildSearchResultSections = (result: ParsedToolResult | null): ToolSection[] => {
  const summary = result?.summary?.trim();
  const output = result?.output?.trim() || result?.details?.trim();
  const metadata = readObject(result?.metadata) ?? readObject(result?.payload);

  if (!summary && !output && !metadata) {
    return [];
  }

  if (metadata) {
    const matchCount = readNumber(metadata.countMatches);
    const fileCount = readNumber(metadata.countFiles);
    const path = readString(metadata.path);
    const flags = formatSummaryMeta([
      matchCount !== undefined ? `${matchCount} matches` : null,
      fileCount !== undefined ? `${fileCount} files` : null,
      path ? `in ${path}` : null,
      readBoolean(metadata.truncated) ? 'truncated' : null,
      readBoolean(metadata.timed_out) ? 'timed out' : null,
    ]);
    if (summary && output && summary !== output && flags) {
      return [
        { label: 'result', content: summary, tone: 'body' },
        { label: 'details', content: `${flags}\n${output}`, tone: 'body' },
      ];
    }
  }

  return [
    {
      label: 'result',
      content: output || summary || '',
      tone: 'body',
    },
  ];
};

const buildSpecialToolPresentation = (
  group: ToolSegmentGroup,
  toolName: string,
  parsedUse: ParsedToolUse | null,
  parsedResult: ParsedToolResult | null
): SpecialToolPresentation | null => {
  const args = parsedUse?.args ?? parseJsonObject(parsedUse?.details);
  if (toolName === 'read_file') {
    return buildReadFilePresentation(args, parsedResult);
  }

  if (toolName === 'file_edit') {
    return buildFileEditPresentation(args, parsedResult);
  }

  if (toolName === 'local_shell') {
    return buildLocalShellPresentation(group, args, parsedResult);
  }

  if (toolName === 'grep' || toolName === 'glob') {
    const sections = buildSearchResultSections(parsedResult);

    return {
      toolLabel: formatToolName(toolName),
      headerDetail: buildSearchHeaderDetail(toolName, args) ?? undefined,
      sections,
    };
  }

  return null;
};

export const AssistantToolGroup = ({ group }: AssistantToolGroupProps) => {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const parsedUse = parseToolUse(group.use?.content, group.use?.data);
  const parsedResult = parseToolResult(group.result?.content, group.result?.data);
  const toolName = parsedUse?.name ?? parsedResult?.name ?? 'tool';
  const commandText = parsedUse?.command;
  const invocationDetails = parsedUse?.details;
  const icon = resolveToolIcon(toolName);
  const outputText = mergeOutputLines(group, parsedResult);
  const _hasInvocationDetails = Boolean(invocationDetails);
  const hasOutput = outputText.length > 0;
  const specialPresentation = buildSpecialToolPresentation(
    group,
    toolName,
    parsedUse,
    parsedResult
  );
  const useCommandAsTitle = toolName === 'local_shell' && Boolean(commandText);
  const titleDetail = useCommandAsTitle
    ? undefined
    : (specialPresentation?.headerDetail ??
      compactDetail(commandText, 64) ??
      compactDetail(invocationDetails, 64));
  const titleText = useCommandAsTitle
    ? `$ ${truncate(commandText ?? '', 86)}`
    : (specialPresentation?.toolLabel ?? formatToolName(toolName));
  const defaultSections: ToolSection[] = [];
  if (commandText && !titleDetail && !useCommandAsTitle) {
    defaultSections.push({
      label: 'command',
      content: `$ ${commandText}`,
      tone: 'code',
    });
  }
  if (invocationDetails && !titleDetail && !useCommandAsTitle) {
    defaultSections.push({
      label: 'arguments',
      content: invocationDetails,
      tone: 'code',
    });
  }
  if (hasOutput) {
    defaultSections.push({
      label: parsedResult?.status === 'error' ? 'error' : 'output',
      content: outputText,
      tone: 'code',
    });
  }
  const sections = specialPresentation?.sections ?? defaultSections;
  const hasBody = sections.length > 0;
  const statusText =
    parsedResult?.status === 'success'
      ? 'completed'
      : parsedResult?.status === 'error'
        ? 'error'
        : group.result
          ? 'finished'
          : 'running';
  const defaultBodyExpanded =
    parsedResult?.status === 'error' || (!group.result && sections.length > 0);
  const [bodyExpanded, setBodyExpanded] = useState(defaultBodyExpanded);
  useEffect(() => {
    setBodyExpanded(parsedResult?.status === 'error' || (!group.result && sections.length > 0));
  }, [group.toolCallId]);
  const showBodyToggle = hasBody;
  const headerRailColor = parsedResult?.status === 'error' ? ERROR_RAIL_COLOR : uiTheme.accent;

  return (
    <box flexDirection="column">
      <box>
        <box flexDirection="row">
          <box
            border={['left']}
            borderColor={headerRailColor}
            customBorderChars={MESSAGE_RAIL_BORDER_CHARS}
          />
          <box
            flexGrow={1}
            paddingLeft={2}
            paddingRight={1}
            paddingTop={1}
            paddingBottom={1}
            backgroundColor={uiTheme.userPromptBg}
          >
            <box flexDirection="row">
              <box flexGrow={1}>
                <text
                  fg={uiTheme.text}
                  attributes={uiTheme.typography.note}
                  wrapMode={'truncate-end' as any}
                  onMouseUp={
                    showBodyToggle ? () => setBodyExpanded((previous) => !previous) : undefined
                  }
                >
                  {useCommandAsTitle ? null : (
                    <>
                      <span fg={uiTheme.accent}>{icon}</span>{' '}
                    </>
                  )}
                  {titleText}
                  {titleDetail ? <span fg={uiTheme.muted}>({titleDetail})</span> : null}
                  <span fg={uiTheme.subtle}> ({statusText})</span>
                </text>
              </box>
              {showBodyToggle ? (
                <text
                  fg={uiTheme.accent}
                  attributes={uiTheme.typography.note}
                  onMouseUp={() => setBodyExpanded((previous) => !previous)}
                >
                  {bodyExpanded ? '⌄' : '›'}
                </text>
              ) : null}
            </box>
          </box>
        </box>
      </box>
      {hasBody && bodyExpanded ? (
        <box flexDirection="row" marginTop={1}>
          <box
            border={['left']}
            borderColor={uiTheme.divider}
            customBorderChars={MESSAGE_RAIL_BORDER_CHARS}
          />
          <box
            flexGrow={1}
            backgroundColor={uiTheme.panel}
            paddingLeft={2}
            paddingRight={1}
            paddingTop={1}
            paddingBottom={1}
          >
            {sections.map((section, index) => {
              const content = normalizeToolDisplayText(section.content);
              const isCode = (section.renderKind ?? section.tone) === 'code';
              const isMarkdown = section.renderKind === 'markdown';
              const sectionId = `${toolName}:section:${index}`;
              const collapsible = isCollapsibleResultSection(section);
              const expanded = Boolean(expandedSections[sectionId]);

              return (
                <box
                  key={sectionId}
                  flexDirection="column"
                  paddingBottom={index < sections.length - 1 ? 1 : 0}
                >
                  {section.label && !isCode ? (
                    <text fg={uiTheme.muted} attributes={uiTheme.typography.note}>
                      {section.label}
                    </text>
                  ) : null}
                  {isCode ? (
                    <box>
                      <CodeBlock
                        content={content}
                        label={section.label}
                        languageHint={resolveSectionLanguageHint(toolName, section)}
                        collapsible={collapsible}
                        collapsedLines={COLLAPSIBLE_OUTPUT_LINES}
                        expanded={expanded}
                        onToggleExpanded={() => {
                          if (!collapsible) {
                            return;
                          }
                          setExpandedSections((previous) => ({
                            ...previous,
                            [sectionId]: !previous[sectionId],
                          }));
                        }}
                      />
                    </box>
                  ) : isMarkdown ? (
                    <box marginTop={section.label ? 1 : 0}>
                      <markdown
                        streaming={false}
                        syntaxStyle={opencodeMarkdownSyntax}
                        content={content}
                        conceal={true}
                      />
                    </box>
                  ) : content ? (
                    <box marginTop={section.label ? 1 : 0}>
                      <text fg={uiTheme.text} attributes={uiTheme.typography.body} wrapMode="word">
                        {content}
                      </text>
                    </box>
                  ) : null}
                </box>
              );
            })}
          </box>
        </box>
      ) : null}
    </box>
  );
};
