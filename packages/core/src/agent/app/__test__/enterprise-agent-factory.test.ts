import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Chunk, LLMProvider } from '../../../providers';
import {
  createEnterpriseAgentAppService,
  createEnterpriseAgentRuntime,
} from '../enterprise-agent-factory';
import { EnterpriseToolSystem } from '../../tool-v2/tool-system';
import { ToolSessionState } from '../../tool-v2/context';
import type { ToolHandler } from '../../tool-v2/registry';

function createProvider(): LLMProvider {
  return {
    config: {} as Record<string, unknown>,
    generate: vi.fn(),
    generateStream: vi.fn(),
    getTimeTimeout: vi.fn(() => 1000),
    getLLMMaxTokens: vi.fn(() => 32000),
    getMaxOutputTokens: vi.fn(() => 4096),
  } as unknown as LLMProvider;
}

function createToolSystem(workspaceDir: string, execute = vi.fn()) {
  return new EnterpriseToolSystem([
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
}

describe('enterprise-agent-factory', () => {
  let tempDir: string | null = null;
  let ownedStore: { close(): Promise<void> } | null = null;

  afterEach(async () => {
    if (ownedStore) {
      await ownedStore.close();
      ownedStore = null;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('passes organizationPolicy into the runtime-created tool executor', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-enterprise-runtime-'));
    const execute = vi.fn();
    const runtime = createEnterpriseAgentRuntime({
      llmProvider: createProvider(),
      toolSystem: createToolSystem(tempDir, execute),
      toolExecutorOptions: {
        workingDirectory: tempDir,
      },
      organizationPolicy: {
        environments: {
          production: {
            rules: [
              {
                id: 'prod-deploy-deny',
                effect: 'deny',
                reason: 'blocked by production policy',
                match: {
                  toolNames: ['deploy_release'],
                },
              },
            ],
          },
        },
      },
      env: {},
    });

    const result = await runtime.toolExecutor.execute(
      {
        id: 'call_1',
        type: 'function',
        index: 0,
        function: {
          name: 'deploy_release',
          arguments: '{}',
        },
      },
      {
        stepIndex: 1,
        agent: {},
        principal: {
          principalId: 'user-1',
          principalType: 'user',
          source: 'cli',
          roles: ['developer'],
          attributes: {
            environment: 'production',
          },
        },
        sessionState: new ToolSessionState(),
      }
    );

    expect(result.success).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    if (result.success) {
      throw new Error('expected deny result');
    }
    expect(result.error.errorCode).toBe('TOOL_V2_POLICY_DENIED');
  });

  it('creates an app service with an owned sqlite store from storePath', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-enterprise-app-'));
    const provider = createProvider();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        yield {
          index: 0,
          choices: [{ index: 0, delta: { content: 'factory ok' } }],
        } as unknown as Chunk;
        yield {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } }],
        } as unknown as Chunk;
      })()
    );

    const composition = createEnterpriseAgentAppService({
      llmProvider: provider,
      storePath: path.join(tempDir, 'agent.db'),
    });
    ownedStore = composition.store || null;

    const result = await composition.appService.runForeground({
      conversationId: 'conv_factory',
      executionId: 'exec_factory',
      userInput: 'say hi',
      maxSteps: 2,
    });

    expect(result.finishReason).toBe('stop');
    expect(result.run.status).toBe('COMPLETED');
    expect(composition.store).toBeTruthy();
  });

  it('loads organizationPolicy from file and binds its version into execution metadata', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-enterprise-policy-file-'));
    const policyFile = path.join(tempDir, 'organization-policy.json');
    await fs.writeFile(
      policyFile,
      JSON.stringify(
        {
          version: 'org-file-v3',
          defaults: {
            network: {
              mode: 'restricted',
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const execute = vi.fn(async () => ({
      output: 'ok',
    }));
    const runtime = createEnterpriseAgentRuntime({
      llmProvider: createProvider(),
      toolSystem: createToolSystem(tempDir, execute),
      toolExecutorOptions: {
        workingDirectory: tempDir,
        trustLevel: 'trusted',
      },
      organizationPolicyFilePath: policyFile,
      env: {},
    });

    let executingPolicyVersion: string | undefined;
    const result = await runtime.toolExecutor.execute(
      {
        id: 'call_2',
        type: 'function',
        index: 0,
        function: {
          name: 'deploy_release',
          arguments: '{}',
        },
      },
      {
        stepIndex: 1,
        agent: {},
        principal: {
          principalId: 'user-2',
          principalType: 'user',
          source: 'cli',
          roles: ['developer'],
        },
        sessionState: new ToolSessionState(),
        onExecutionEvent: async (event) => {
          if (event.stage === 'executing') {
            executingPolicyVersion =
              typeof event.metadata?.policyVersion === 'string'
                ? event.metadata.policyVersion
                : undefined;
          }
        },
      }
    );

    expect(result.success).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(executingPolicyVersion).toBe('org-file-v3');
  });

  it('skips organization policy and enables unrestricted execution in full access mode', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-enterprise-full-access-'));
    const policyFile = path.join(tempDir, 'organization-policy.json');
    await fs.writeFile(
      policyFile,
      JSON.stringify(
        {
          version: 'org-file-deny',
          environments: {
            production: {
              rules: [
                {
                  id: 'prod-deploy-deny',
                  effect: 'deny',
                  reason: 'blocked by production policy',
                  match: {
                    toolNames: ['deploy_release'],
                  },
                },
              ],
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const execute = vi.fn(async () => ({
      output: 'ok',
    }));
    const runtime = createEnterpriseAgentRuntime({
      llmProvider: createProvider(),
      toolSystem: createToolSystem(tempDir, execute),
      toolExecutorOptions: {
        workingDirectory: tempDir,
      },
      organizationPolicyFilePath: policyFile,
      env: {
        AGENT_FULL_ACCESS: 'true',
      },
    });

    const result = await runtime.toolExecutor.execute(
      {
        id: 'call_3',
        type: 'function',
        index: 0,
        function: {
          name: 'deploy_release',
          arguments: '{}',
        },
      },
      {
        stepIndex: 1,
        agent: {},
        principal: {
          principalId: 'user-3',
          principalType: 'user',
          source: 'cli',
          roles: ['developer'],
          attributes: {
            environment: 'production',
          },
        },
        sessionState: new ToolSessionState(),
      }
    );

    expect(result.success).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('applies default permission baseline from env-backed config values', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-enterprise-config-permissions-'));
    const runtime = createEnterpriseAgentRuntime({
      llmProvider: createProvider(),
      toolSystem: createToolSystem(tempDir, vi.fn()),
      toolExecutorOptions: {
        workingDirectory: tempDir,
      },
      env: {
        AGENT_DEFAULT_TRUST_LEVEL: 'untrusted',
        AGENT_DEFAULT_APPROVAL_POLICY: 'unless-trusted',
        AGENT_DEFAULT_FILESYSTEM_MODE: 'workspace-write',
        AGENT_DEFAULT_NETWORK_MODE: 'enabled',
      },
    });

    const executor = runtime.toolExecutor as unknown as {
      fileSystemPolicy?: { mode: string; readRoots: string[]; writeRoots: string[] };
      networkPolicy?: { mode: string };
      approvalPolicy?: string;
      trustLevel?: string;
    };

    expect(executor.fileSystemPolicy).toEqual({
      mode: 'restricted',
      readRoots: [tempDir],
      writeRoots: [tempDir],
    });
    expect(executor.networkPolicy).toEqual({
      mode: 'enabled',
    });
    expect(executor.approvalPolicy).toBe('unless-trusted');
    expect(executor.trustLevel).toBe('untrusted');
  });
});
