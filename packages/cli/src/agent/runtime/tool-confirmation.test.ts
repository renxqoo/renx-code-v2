import { describe, expect, it } from 'vitest';

import { resolveToolConfirmDecision, resolveToolPermissionGrant } from './tool-confirmation';
import type { AgentEventHandlers, AgentToolConfirmEvent, AgentToolPermissionEvent } from './types';

const TOOL_CONFIRM_EVENT: AgentToolConfirmEvent = {
  kind: 'approval',
  toolCallId: 'call_1',
  toolName: 'glob',
  args: {
    pattern: '**/*sandbox*',
    path: '/tmp/project',
  },
  rawArgs: {
    pattern: '**/*sandbox*',
    path: '/tmp/project',
  },
  reason: 'SEARCH_PATH_NOT_ALLOWED: /tmp/project is outside allowed directories: /workspace',
  metadata: {
    requestedPath: '/tmp/project',
    allowedDirectories: ['/workspace'],
  },
};

const TOOL_PERMISSION_EVENT: AgentToolPermissionEvent = {
  kind: 'permission',
  toolCallId: 'call_perm',
  toolName: 'read_file',
  reason: 'Additional permissions required to read /tmp/project',
  requestedScope: 'turn',
  permissions: {
    fileSystem: {
      read: ['/tmp/project'],
    },
  },
};

describe('resolveToolConfirmDecision', () => {
  it('asks the UI callback when registered', async () => {
    const calls: AgentToolConfirmEvent[] = [];
    const onToolConfirmRequest: NonNullable<AgentEventHandlers['onToolConfirmRequest']> = async (
      event
    ) => {
      calls.push(event);
      return {
        approved: false,
        message: 'Denied by user',
      };
    };

    const decision = await resolveToolConfirmDecision(TOOL_CONFIRM_EVENT, { onToolConfirmRequest });

    expect(decision).toEqual({
      approved: false,
      message: 'Denied by user',
    });
    expect(calls).toEqual([TOOL_CONFIRM_EVENT]);
  });

  it('falls back to deny when no UI callback is registered', async () => {
    const decision = await resolveToolConfirmDecision(TOOL_CONFIRM_EVENT, {});

    expect(decision).toEqual({
      approved: false,
      message: 'Tool confirmation handler is not available.',
    });
  });

  it('returns granted permissions from the UI callback when registered', async () => {
    const onToolPermissionRequest: NonNullable<
      AgentEventHandlers['onToolPermissionRequest']
    > = async () => ({
      granted: {
        fileSystem: {
          read: ['/tmp/project'],
        },
      },
      scope: 'turn',
    });

    const grant = await resolveToolPermissionGrant(TOOL_PERMISSION_EVENT, {
      onToolPermissionRequest,
    });

    expect(grant).toEqual({
      granted: {
        fileSystem: {
          read: ['/tmp/project'],
        },
      },
      scope: 'turn',
    });
  });

  it('falls back to empty permissions when no UI callback is registered', async () => {
    const grant = await resolveToolPermissionGrant(TOOL_PERMISSION_EVENT, {});

    expect(grant).toEqual({
      granted: {},
      scope: 'turn',
    });
  });
});
