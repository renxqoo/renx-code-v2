import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import type { ReplySegment } from '../../types/chat';
import type { ToolSegmentGroup } from './segment-groups';
import { AssistantToolGroup } from './assistant-tool-group';

const createToolUseSegment = (command: string): ReplySegment => ({
  id: '1:tool-use:call_local_shell',
  type: 'text',
  content: '',
  data: {
    id: 'call_local_shell',
    function: {
      name: 'local_shell',
      arguments: JSON.stringify({ command }),
    },
  },
});

const createToolResultSegment = (): ReplySegment => ({
  id: '1:tool-result:call_local_shell',
  type: 'text',
  content: '',
  data: {
    toolCall: {
      id: 'call_local_shell',
      function: {
        name: 'local_shell',
      },
    },
    result: {
      success: true,
      data: {
        summary: 'Command completed successfully with no output.',
      },
    },
  },
});

describe('AssistantToolGroup', () => {
  it('renders local shell headers as a prompt-style command line', () => {
    const command = 'grep -n "DEFAULT_MAX_STEPS\\|10000" src/agent/runtime/runtime.ts';
    const group: ToolSegmentGroup = {
      toolCallId: 'call_local_shell',
      streams: [],
      use: createToolUseSegment(command),
      result: createToolResultSegment(),
    };

    const { container } = render(<AssistantToolGroup group={group} />);
    const headerText = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(headerText).toContain(`$ ${command} (completed)`);
    expect(headerText).not.toContain('local_shell');
  });
});
