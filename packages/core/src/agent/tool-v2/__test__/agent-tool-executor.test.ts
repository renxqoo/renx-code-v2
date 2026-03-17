import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import type { ToolCall } from '../../../providers';
import { createSystemPrincipal } from '../../auth/principal';
import type { ToolHandler } from '../registry';
import { ToolSessionState } from '../context';
import { EnterpriseToolExecutor } from '../agent-tool-executor';
import { EnterpriseToolSystem } from '../tool-system';

function createToolCall(toolName: string, args: Record<string, unknown>): ToolCall {
  return {
    id: 'call_1',
    type: 'function',
    index: 0,
    function: {
      name: toolName,
      arguments: JSON.stringify(args),
    },
  };
}

describe('EnterpriseToolExecutor', () => {
  it('maps tool-v2 specs into provider tool schemas', () => {
    const system = new EnterpriseToolSystem([
      {
        spec: {
          name: 'read_file',
          description: 'Read a file',
          inputSchema: { type: 'object' },
          supportsParallel: true,
          mutating: false,
        },
        parseArguments: vi.fn(),
        plan: vi.fn(),
        execute: vi.fn(),
      } satisfies ToolHandler,
    ]);

    const executor = new EnterpriseToolExecutor({ system });

    expect(executor.getToolSchemas()).toEqual([
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: { type: 'object' },
        },
      },
    ]);
  });

  it('turns external policy denial into a native tool failure', async () => {
    const system = new EnterpriseToolSystem([
      {
        spec: {
          name: 'local_shell',
          description: 'Run a local command',
          inputSchema: { type: 'object' },
          supportsParallel: false,
          mutating: true,
        },
        parseArguments: vi.fn((raw: string) => JSON.parse(raw)),
        plan: vi.fn(() => ({ mutating: true })),
        execute: vi.fn(),
      } satisfies ToolHandler,
    ]);

    const executor = new EnterpriseToolExecutor({ system });
    const result = await executor.execute(createToolCall('local_shell', { command: 'rm -rf /' }), {
      stepIndex: 1,
      agent: {},
      principal: createSystemPrincipal('executor-test'),
      sessionState: new ToolSessionState(),
      onPolicyCheck: async () => ({
        allowed: false,
        code: 'DANGEROUS_COMMAND',
        message: 'rm blocked',
      }),
    });

    expect(result).toMatchObject({
      success: false,
      output: 'Tool local_shell blocked by policy [DANGEROUS_COMMAND]: rm blocked',
    });
    if (result.success) {
      throw new Error('expected failure');
    }
    expect(result.error.errorCode).toBe('TOOL_V2_POLICY_DENIED');
  });

  it('derives concurrency policy from handler parallel capability', () => {
    const system = new EnterpriseToolSystem([
      {
        spec: {
          name: 'search_text',
          description: 'Search text',
          inputSchema: { type: 'object' },
          supportsParallel: true,
          mutating: false,
        },
        parseArguments: vi.fn((raw: string) => JSON.parse(raw)),
        plan: vi.fn(() => ({ mutating: false })),
        execute: vi.fn(),
      } satisfies ToolHandler,
    ]);

    const executor = new EnterpriseToolExecutor({ system });

    expect(executor.getConcurrencyPolicy(createToolCall('search_text', { pattern: 'x' }))).toEqual({
      mode: 'parallel-safe',
    });
    expect(executor.getConcurrencyPolicy(createToolCall('missing', {}))).toEqual({
      mode: 'exclusive',
    });
  });

  it('derives keyed concurrency policy from handler execution plan when available', () => {
    const system = new EnterpriseToolSystem([
      {
        spec: {
          name: 'read_file',
          description: 'Read a file',
          inputSchema: { type: 'object' },
          supportsParallel: true,
          mutating: false,
        },
        parseArguments: vi.fn((raw: string) => JSON.parse(raw)),
        plan: vi.fn((args: { path: string }) => ({
          mutating: false,
          concurrency: {
            mode: 'parallel-safe',
            lockKey: `read_file:${args.path}`,
          },
        })),
        execute: vi.fn(),
      } satisfies ToolHandler,
    ]);

    const executor = new EnterpriseToolExecutor({ system, workingDirectory: '/tmp/work' });

    expect(
      executor.getConcurrencyPolicy(createToolCall('read_file', { path: '/tmp/work/a.ts' }))
    ).toEqual({
      mode: 'parallel-safe',
      lockKey: 'read_file:/tmp/work/a.ts',
    });
  });

  it('auto-finalizes write_file buffered protocol responses before returning to the agent', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        output: JSON.stringify({
          ok: false,
          code: 'WRITE_FILE_PARTIAL_BUFFERED',
          message: 'buffered',
          nextAction: 'finalize',
          nextArgs: {
            mode: 'finalize',
            bufferId: 'buffer-1',
            path: '/tmp/out.txt',
          },
        }),
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          ok: true,
          code: 'WRITE_FILE_FINALIZE_OK',
          message: 'done',
          nextAction: 'none',
        }),
      });

    const system = new EnterpriseToolSystem([
      {
        spec: {
          name: 'write_file',
          description: 'Write file',
          inputSchema: { type: 'object' },
          supportsParallel: false,
          mutating: true,
        },
        parseArguments: vi.fn((raw: string) => JSON.parse(raw)),
        plan: vi.fn(() => ({ mutating: true })),
        execute,
      } satisfies ToolHandler,
    ]);

    const executor = new EnterpriseToolExecutor({ system });
    const result = await executor.execute(
      createToolCall('write_file', { path: '/tmp/out.txt', content: 'x' }),
      {
        stepIndex: 1,
        agent: {},
        principal: createSystemPrincipal('executor-test'),
        sessionState: new ToolSessionState(),
      }
    );

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1]?.[0]).toEqual({
      mode: 'finalize',
      bufferId: 'buffer-1',
      path: '/tmp/out.txt',
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error('expected success');
    }
    expect(result.toolCallId).toBe('call_1');
    expect(result.metadata).toMatchObject({
      autoFinalized: true,
      bufferId: 'buffer-1',
    });
  });

  it('applies organization environment deny rules before tool execution', async () => {
    const execute = vi.fn();
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-org-deny-'));
    try {
      const system = new EnterpriseToolSystem([
        {
          spec: {
            name: 'deploy_release',
            description: 'Deploy release',
            inputSchema: { type: 'object' },
            supportsParallel: false,
            mutating: true,
          },
          parseArguments: vi.fn((raw: string) => JSON.parse(raw)),
          plan: vi.fn(() => ({
            mutating: true,
            writePaths: [path.join(workspaceDir, 'artifact.txt')],
            riskLevel: 'high',
          })),
          execute,
        } satisfies ToolHandler,
      ]);

      const executor = new EnterpriseToolExecutor({
        system,
        workingDirectory: workspaceDir,
        organizationPolicy: {
          environments: {
            production: {
              rules: [
                {
                  id: 'prod-deploy-deny',
                  effect: 'deny',
                  reason: 'production environment blocks deploy_release by policy',
                  match: {
                    toolNames: ['deploy_release'],
                  },
                },
              ],
            },
          },
        },
      });

      const result = await executor.execute(createToolCall('deploy_release', {}), {
        stepIndex: 1,
        agent: {},
        principal: {
          ...createSystemPrincipal('executor-test'),
          workspaceId: 'workspace-prod',
          attributes: {
            environment: 'production',
          },
        },
        sessionState: new ToolSessionState(),
      });

      expect(result.success).toBe(false);
      expect(execute).not.toHaveBeenCalled();
      if (result.success) {
        throw new Error('expected failure');
      }
      expect(result.error.errorCode).toBe('TOOL_V2_POLICY_DENIED');
      expect(result.output).toContain('prod-deploy-deny');
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('injects organization approval requirements for matched workspaces', async () => {
    const execute = vi.fn(async () => ({
      output: 'ok',
    }));
    const approvals: Array<{ toolName: string; reason: string; key?: string }> = [];
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-org-approval-'));
    try {
      const system = new EnterpriseToolSystem([
        {
          spec: {
            name: 'publish_docs',
            description: 'Publish docs',
            inputSchema: { type: 'object' },
            supportsParallel: false,
            mutating: true,
          },
          parseArguments: vi.fn((raw: string) => JSON.parse(raw)),
          plan: vi.fn(() => ({
            mutating: true,
            writePaths: [path.join(workspaceDir, 'docs', 'site.html')],
          })),
          execute,
        } satisfies ToolHandler,
      ]);

      const executor = new EnterpriseToolExecutor({
        system,
        workingDirectory: workspaceDir,
        trustLevel: 'trusted',
        organizationPolicy: {
          workspaces: [
            {
              rootPath: workspaceDir,
              rules: [
                {
                  id: 'workspace-publish-approval',
                  effect: 'require_approval',
                  reason: 'workspace publishing requires manual approval',
                  approvalKey: 'workspace:publish_docs',
                  match: {
                    toolNames: ['publish_docs'],
                  },
                },
              ],
            },
          ],
        },
      });

      const result = await executor.execute(createToolCall('publish_docs', {}), {
        stepIndex: 1,
        agent: {},
        principal: {
          ...createSystemPrincipal('executor-test'),
          workspaceId: 'workspace-docs',
        },
        sessionState: new ToolSessionState(),
        onApproval: async (request) => {
          approvals.push({
            toolName: request.toolName,
            reason: request.reason,
            key: request.key,
          });
          return {
            approved: true,
            scope: 'once',
            approverId: 'approver-1',
          };
        },
      });

      expect(result.success).toBe(true);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(approvals).toEqual([
        {
          toolName: 'publish_docs',
          reason: 'workspace publishing requires manual approval',
          key: 'workspace:publish_docs',
        },
      ]);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
