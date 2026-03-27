import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import { uiTheme } from '../../ui/theme';
import type { ReplySegment } from '../../types/chat';
import { PromptCard } from './prompt-card';
import type { ToolSegmentGroup } from './segment-groups';
import { AssistantToolGroup } from './assistant-tool-group';

const createToolUseSegment = (
  name: string,
  args: Record<string, unknown>,
  callId = `call_${name}`
): ReplySegment => ({
  id: `1:tool-use:${callId}`,
  type: 'text',
  content: '',
  data: {
    id: callId,
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  },
});

const createToolResultSegment = (
  name: string,
  data: Record<string, unknown>,
  options?: { callId?: string; success?: boolean }
): ReplySegment => ({
  id: `1:tool-result:${options?.callId ?? `call_${name}`}`,
  type: 'text',
  content: '',
  data: {
    toolCall: {
      id: options?.callId ?? `call_${name}`,
      function: {
        name,
      },
    },
    result: {
      success: options?.success ?? true,
      data,
    },
  },
});

const createToolStreamSegment = (
  callId: string,
  channel: 'stdout' | 'stderr',
  content: string
): ReplySegment => ({
  id: `1:tool:${callId}:${channel}`,
  type: 'text',
  content,
});

const toggleToolDetails = (container: HTMLElement, label: '›' | '⌄' = '›') => {
  const toggle = Array.from(container.querySelectorAll('text')).find((node) =>
    (node.textContent ?? '').trim().endsWith(label)
  );
  expect(toggle).toBeTruthy();
  fireEvent.mouseUp(toggle!);
};

describe('AssistantToolGroup', () => {
  it('matches the user card presentation except for rail color', () => {
    const group: ToolSegmentGroup = {
      toolCallId: 'call_read_file_prompt_card_match',
      streams: [],
      use: createToolUseSegment(
        'read_file',
        { path: 'notes/todo.txt', mode: 'text' },
        'call_read_file_prompt_card_match'
      ),
      result: createToolResultSegment(
        'read_file',
        {
          output: 'L1: buy milk',
        },
        { callId: 'call_read_file_prompt_card_match' }
      ),
    };

    const { container } = render(<AssistantToolGroup group={group} />);
    const { container: promptContainer } = render(<PromptCard prompt="hello" isFirst={true} />);
    const rootBox = container.querySelector('box');
    const headerPaddingBox = rootBox?.children[0] as HTMLElement | undefined;
    const headerRowBox = headerPaddingBox?.firstElementChild as HTMLElement | null;
    const headerRailBox = headerRowBox?.firstElementChild as HTMLElement | null;
    const headerContentBox = headerRailBox?.nextElementSibling as HTMLElement | null;

    const promptRootBox = promptContainer.querySelector('box');
    const promptRailBox = promptRootBox?.firstElementChild as HTMLElement | null;
    const promptContentBox = promptRailBox?.nextElementSibling as HTMLElement | null;

    expect(headerPaddingBox?.getAttribute('paddingleft')).toBe(
      promptRootBox?.getAttribute('paddingleft')
    );

    expect(headerContentBox?.getAttribute('backgroundcolor')).toBe(
      promptContentBox?.getAttribute('backgroundcolor')
    );
    expect(headerRailBox?.getAttribute('customborderchars')).toBe(
      promptRailBox?.getAttribute('customborderchars')
    );
    expect(headerContentBox?.getAttribute('paddingleft')).toBe(
      promptContentBox?.getAttribute('paddingleft')
    );
    expect(headerContentBox?.getAttribute('paddingright')).toBe(
      promptContentBox?.getAttribute('paddingright')
    );
    expect(headerContentBox?.getAttribute('paddingtop')).toBe(
      promptContentBox?.getAttribute('paddingtop')
    );
    expect(headerContentBox?.getAttribute('paddingbottom')).toBe(
      promptContentBox?.getAttribute('paddingbottom')
    );
    expect(headerRailBox?.getAttribute('bordercolor')).toBe(uiTheme.accent);
    expect(headerRailBox?.getAttribute('bordercolor')).not.toBe(
      promptRailBox?.getAttribute('bordercolor')
    );
  });

  it('uses the theme accent rail for non-error tool headers', () => {
    const group: ToolSegmentGroup = {
      toolCallId: 'call_read_file_header_accent',
      streams: [],
      use: createToolUseSegment(
        'read_file',
        { path: 'notes/todo.txt', mode: 'text' },
        'call_read_file_header_accent'
      ),
      result: createToolResultSegment(
        'read_file',
        {
          output: 'L1: buy milk',
        },
        { callId: 'call_read_file_header_accent' }
      ),
    };

    const { container } = render(<AssistantToolGroup group={group} />);
    const rootBox = container.querySelector('box');
    const headerPaddingBox = rootBox?.children[0] as HTMLElement | undefined;
    const headerSurfaceBox = headerPaddingBox?.firstElementChild as HTMLElement | null;
    const headerRailBox = headerSurfaceBox?.firstElementChild as HTMLElement | null;

    expect(headerRailBox?.getAttribute('bordercolor')).toBe(uiTheme.accent);
  });

  it('reduces expanded body left indent to stay visually aligned with the header', () => {
    const group: ToolSegmentGroup = {
      toolCallId: 'call_read_file_body_align',
      streams: [],
      use: createToolUseSegment(
        'read_file',
        { path: 'notes/todo.txt', mode: 'text' },
        'call_read_file_body_align'
      ),
      result: createToolResultSegment(
        'read_file',
        {
          output: ['L1: buy milk', 'L2: ship cli ui'].join('\n'),
        },
        { callId: 'call_read_file_body_align' }
      ),
    };

    const { container } = render(<AssistantToolGroup group={group} />);
    toggleToolDetails(container);

    const rootBox = container.querySelector('box');
    const bodyRow = rootBox?.children[1] as HTMLElement | undefined;
    const bodyContentBox = bodyRow?.children[1] as HTMLElement | undefined;

    expect(bodyContentBox?.getAttribute('paddingleft')).toBe('2');
  });

  it('uses a red rail for error tool headers', () => {
    const group: ToolSegmentGroup = {
      toolCallId: 'call_local_shell_header_error_rail',
      use: createToolUseSegment(
        'local_shell',
        { command: 'node src/index.ts' },
        'call_local_shell_header_error_rail'
      ),
      streams: [
        createToolStreamSegment('call_local_shell_header_error_rail', 'stderr', 'Error: boom'),
      ],
      result: createToolResultSegment(
        'local_shell',
        {
          summary: 'Command failed.',
          metadata: { exitCode: 1 },
        },
        { callId: 'call_local_shell_header_error_rail', success: false }
      ),
    };

    const { container } = render(<AssistantToolGroup group={group} />);
    const rootBox = container.querySelector('box');
    const headerPaddingBox = rootBox?.children[0] as HTMLElement | undefined;
    const headerSurfaceBox = headerPaddingBox?.firstElementChild as HTMLElement | null;
    const headerRailBox = headerSurfaceBox?.firstElementChild as HTMLElement | null;

    expect(headerRailBox?.getAttribute('bordercolor')).toBe('#dc2626');
  });

  it('collapses successful tool output by default and toggles details on demand', () => {
    const group: ToolSegmentGroup = {
      toolCallId: 'call_read_file_collapsed',
      streams: [],
      use: createToolUseSegment(
        'read_file',
        { path: 'notes/todo.txt', mode: 'text' },
        'call_read_file_collapsed'
      ),
      result: createToolResultSegment(
        'read_file',
        {
          output: ['L1: buy milk', 'L2: ship cli ui'].join('\n'),
        },
        { callId: 'call_read_file_collapsed' }
      ),
    };

    const { container } = render(<AssistantToolGroup group={group} />);
    const initialText = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(initialText).not.toContain('展开输出');
    expect(initialText).not.toContain('收起输出');
    expect(initialText).toContain('›');
    expect(container.querySelector('code')).toBeNull();

    const showToggle = Array.from(container.querySelectorAll('text')).find((node) =>
      (node.textContent ?? '').trim().endsWith('›')
    );
    expect(showToggle).toBeTruthy();

    fireEvent.mouseUp(showToggle!);

    const expandedText = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(expandedText).not.toContain('展开输出');
    expect(expandedText).not.toContain('收起输出');
    expect(expandedText).toContain('⌄');
    expect(container.querySelector('code')).not.toBeNull();
  });

  it('keeps failed tool output expanded by default', () => {
    const stderr = 'Error: Cannot find module ./missing.js';
    const group: ToolSegmentGroup = {
      toolCallId: 'call_local_shell_failed_default_open',
      use: createToolUseSegment(
        'local_shell',
        { command: 'node src/index.ts' },
        'call_local_shell_failed_default_open'
      ),
      streams: [createToolStreamSegment('call_local_shell_failed_default_open', 'stderr', stderr)],
      result: createToolResultSegment(
        'local_shell',
        {
          summary: 'Command failed.',
          metadata: { exitCode: 1 },
        },
        { callId: 'call_local_shell_failed_default_open', success: false }
      ),
    };

    const { container } = render(<AssistantToolGroup group={group} />);
    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(text).toContain('⌄');
    expect(text).toContain('stderr error');
    expect(container.querySelector('code')).not.toBeNull();
  });

  it('keeps running tool output expanded by default', () => {
    const group: ToolSegmentGroup = {
      toolCallId: 'call_local_shell_running_default_open',
      use: createToolUseSegment(
        'local_shell',
        { command: 'bun test' },
        'call_local_shell_running_default_open'
      ),
      streams: [
        createToolStreamSegment(
          'call_local_shell_running_default_open',
          'stdout',
          'running tests...\n'
        ),
      ],
    };

    const { container } = render(<AssistantToolGroup group={group} />);
    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(text).toContain('running');
    expect(text).toContain('⌄');
    expect(text).toContain('stdout');
  });

  it('keeps the body open when the same running tool call completes successfully', () => {
    const runningGroup: ToolSegmentGroup = {
      toolCallId: 'call_local_shell_preserve_open_on_success',
      use: createToolUseSegment(
        'local_shell',
        { command: 'bun test' },
        'call_local_shell_preserve_open_on_success'
      ),
      streams: [
        createToolStreamSegment(
          'call_local_shell_preserve_open_on_success',
          'stdout',
          'running tests...\n'
        ),
      ],
    };

    const completedGroup: ToolSegmentGroup = {
      ...runningGroup,
      result: createToolResultSegment(
        'local_shell',
        {
          summary: 'Command completed successfully.',
          output: 'running tests...\nAll tests passed.',
        },
        { callId: 'call_local_shell_preserve_open_on_success' }
      ),
    };

    const { container, rerender } = render(<AssistantToolGroup group={runningGroup} />);
    const runningText = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(runningText).toContain('⌄');
    expect(runningText).toContain('stdout');

    rerender(<AssistantToolGroup group={completedGroup} />);

    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(text).toContain('⌄');
    expect(text).toContain('stdout');
    expect(text).toContain('running tests...');
  });

  it('renders the tool header inside a separate container from the output body', () => {
    const group: ToolSegmentGroup = {
      toolCallId: 'call_local_shell_header_surface',
      use: createToolUseSegment(
        'local_shell',
        { command: 'node src/index.ts' },
        'call_local_shell_header_surface'
      ),
      streams: [
        createToolStreamSegment('call_local_shell_header_surface', 'stderr', 'Error: boom'),
      ],
      result: createToolResultSegment(
        'local_shell',
        {
          summary: 'Command failed.',
          metadata: { exitCode: 1 },
        },
        { callId: 'call_local_shell_header_surface', success: false }
      ),
    };

    const { container } = render(<AssistantToolGroup group={group} />);
    const rootBox = container.querySelector('box');
    const headerPaddingBox = rootBox?.children[0] as HTMLElement | undefined;
    const headerSurfaceBox = headerPaddingBox?.firstElementChild as HTMLElement | null;
    const headerRailBox = headerSurfaceBox?.firstElementChild as HTMLElement | null;

    expect(headerPaddingBox?.tagName.toLowerCase()).toBe('box');
    expect(headerSurfaceBox?.tagName.toLowerCase()).toBe('box');
    expect(headerRailBox?.tagName.toLowerCase()).toBe('box');
  });

  it('truncates long tool invocation text in the header to keep it on one line', () => {
    const command =
      'python scripts/really-long-command.py --project packages/cli --input src/components/chat/assistant-tool-group.tsx --output /tmp/very/long/path/result.json --flag-one --flag-two --flag-three';
    const group: ToolSegmentGroup = {
      toolCallId: 'call_local_shell_long_header',
      streams: [],
      use: createToolUseSegment('local_shell', { command }, 'call_local_shell_long_header'),
      result: createToolResultSegment(
        'local_shell',
        {
          summary: 'Command completed successfully with no output.',
        },
        { callId: 'call_local_shell_long_header' }
      ),
    };

    const { container } = render(<AssistantToolGroup group={group} />);
    const headerText = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(headerText).toContain('$ python scripts/really-long-command.py');
    expect(headerText).toContain('…');
    expect(headerText).toContain('(completed)');
    expect(headerText).not.toContain('--flag-three');
  });

  it('summarizes file_edit diff results without repeating match and replacement blocks', () => {
    const diff = [
      'diff --git a/src/example.tsx b/src/example.tsx',
      '--- a/src/example.tsx',
      '+++ b/src/example.tsx',
      '@@ -1,2 +1,20 @@',
      '-const before = true;',
      '+const after = true;',
      ...Array.from({ length: 18 }, (_, index) => `+const line${index + 1} = ${index + 1};`),
    ].join('\n');

    const group: ToolSegmentGroup = {
      toolCallId: 'call_file_edit_compact_diff',
      streams: [],
      use: createToolUseSegment(
        'file_edit',
        {
          path: 'src/example.tsx',
          dryRun: false,
          edits: [
            {
              oldText: 'const before = true;\nconst keep = 1;',
              newText: 'const after = true;\nconst keep = 1;\nconst extra = 2;',
            },
          ],
        },
        'call_file_edit_compact_diff'
      ),
      result: createToolResultSegment(
        'file_edit',
        {
          summary: 'Applied 1 edit to src/example.tsx.',
          output: diff,
        },
        { callId: 'call_file_edit_compact_diff' }
      ),
    };

    const { container } = render(<AssistantToolGroup group={group} />);
    toggleToolDetails(container);

    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(text).toContain('Applied 1 edit to src/example.tsx.');
    expect(text).toContain('diff');
    expect(text).toContain('hidden');
    expect(text).not.toContain('match');
    expect(text).not.toContain('replace with');
    expect(container.querySelector('diff')).not.toBeNull();
  });
});
