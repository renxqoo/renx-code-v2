import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorizationService } from '../../auth/authorization-service';
import { createSystemPrincipal } from '../../auth/principal';
import { EnterpriseToolSystem } from '../tool-system';
import { ToolSessionState, type ToolExecutionContext } from '../context';
import { createRestrictedNetworkPolicy, createWorkspaceFileSystemPolicy } from '../permissions';
import { FileEditToolV2 } from '../handlers/file-edit';
import { FileHistoryListToolV2 } from '../handlers/file-history-list';
import { FileHistoryRestoreToolV2 } from '../handlers/file-history-restore';
import { LspToolV2 } from '../handlers/lsp';
import { ReadFileToolV2 } from '../handlers/read-file';
import { RequestPermissionsToolV2 } from '../handlers/request-permissions';
import { WebFetchToolV2 } from '../handlers/web-fetch';
import { WriteFileToolV2 } from '../handlers/write-file';

describe('tool-v2 enterprise system', () => {
  let workspaceDir: string;
  let system: EnterpriseToolSystem;
  let sessionState: ToolSessionState;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-tool-v2-'));
    system = new EnterpriseToolSystem([
      new ReadFileToolV2(),
      new WriteFileToolV2(),
      new FileEditToolV2(),
      new FileHistoryListToolV2(),
      new FileHistoryRestoreToolV2(),
      new RequestPermissionsToolV2(),
    ]);
    sessionState = new ToolSessionState();
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it('writes, edits, and restores file history through orchestrated tool calls', async () => {
    const targetFile = path.join(workspaceDir, 'note.txt');

    const writeResult = await system.execute(
      {
        toolCallId: 'write-1',
        toolName: 'write_file',
        arguments: JSON.stringify({
          path: targetFile,
          content: 'alpha\nbeta\n',
        }),
      },
      createContext(workspaceDir, sessionState)
    );
    expect(writeResult.success).toBe(true);
    expect(await fs.readFile(targetFile, 'utf8')).toBe('alpha\nbeta\n');

    const editResult = await system.execute(
      {
        toolCallId: 'edit-1',
        toolName: 'file_edit',
        arguments: JSON.stringify({
          path: targetFile,
          edits: [
            {
              oldText: 'beta',
              newText: 'gamma',
            },
          ],
        }),
      },
      createContext(workspaceDir, sessionState)
    );
    expect(editResult.success).toBe(true);
    expect(await fs.readFile(targetFile, 'utf8')).toBe('alpha\ngamma\n');

    const historyResult = await system.execute(
      {
        toolCallId: 'history-1',
        toolName: 'file_history_list',
        arguments: JSON.stringify({
          path: targetFile,
        }),
      },
      createContext(workspaceDir, sessionState)
    );
    expect(historyResult.success).toBe(true);
    if (!historyResult.success) {
      return;
    }
    expect(historyResult.structured).toMatchObject({
      path: targetFile,
    });
    const versions = (historyResult.structured as { versions: Array<{ versionId: string }> })
      .versions;
    expect(versions.length).toBeGreaterThan(0);

    const restoreResult = await system.execute(
      {
        toolCallId: 'restore-1',
        toolName: 'file_history_restore',
        arguments: JSON.stringify({
          path: targetFile,
          versionId: versions[0]?.versionId,
        }),
      },
      createContext(workspaceDir, sessionState)
    );
    expect(restoreResult.success).toBe(true);
    expect(await fs.readFile(targetFile, 'utf8')).toBe('alpha\nbeta\n');
  });

  it('stores granted permissions at turn scope when request_permissions succeeds', async () => {
    const context = createContext(workspaceDir, sessionState, {
      requestPermissions: async (request) => ({
        granted: request.permissions,
        scope: 'turn',
      }),
    });

    const result = await system.execute(
      {
        toolCallId: 'perm-1',
        toolName: 'request_permissions',
        arguments: JSON.stringify({
          scope: 'turn',
          permissions: {
            network: {
              enabled: true,
              allowedHosts: ['example.com'],
            },
          },
        }),
      },
      context
    );

    expect(result.success).toBe(true);
    expect(sessionState.effectivePermissions()).toMatchObject({
      network: {
        enabled: true,
        allowedHosts: ['example.com'],
      },
    });
  });

  it('exposes outputSchema for handlers with stable structured payloads', () => {
    const specs = system.specs();
    const readFile = specs.find((spec) => spec.name === 'read_file');
    const writeFile = specs.find((spec) => spec.name === 'write_file');

    expect(readFile?.outputSchema).toMatchObject({
      type: 'object',
      properties: {
        path: { type: 'string' },
        etag: { type: 'string' },
        truncated: { type: 'boolean' },
      },
    });
    expect(writeFile?.outputSchema).toMatchObject({
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        code: { type: 'string' },
        nextAction: { type: 'string' },
      },
    });
  });

  it('buffers oversized write_file payloads and finalizes them with a follow-up call', async () => {
    const targetFile = path.join(workspaceDir, 'big.txt');
    const bufferDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-tool-v2-buffer-'));
    const largeContent = '0123456789abcdef';
    const localSystem = new EnterpriseToolSystem([
      new WriteFileToolV2({
        maxChunkBytes: 8,
        bufferBaseDir: bufferDir,
      }),
    ]);

    try {
      const directResult = await localSystem.execute(
        {
          toolCallId: 'write-large',
          toolName: 'write_file',
          arguments: JSON.stringify({
            path: targetFile,
            content: largeContent,
          }),
        },
        createContext(workspaceDir, new ToolSessionState())
      );

      expect(directResult.success).toBe(true);
      if (!directResult.success) {
        return;
      }
      expect(directResult.structured).toMatchObject({
        code: 'WRITE_FILE_PARTIAL_BUFFERED',
        nextAction: 'finalize',
      });

      const bufferId = (directResult.structured as { buffer?: { bufferId: string } }).buffer
        ?.bufferId;
      expect(bufferId).toBeTruthy();

      const finalizeResult = await localSystem.execute(
        {
          toolCallId: 'write-large-finalize',
          toolName: 'write_file',
          arguments: JSON.stringify({
            mode: 'finalize',
            bufferId,
          }),
        },
        createContext(workspaceDir, new ToolSessionState())
      );

      expect(finalizeResult.success).toBe(true);
      if (!finalizeResult.success) {
        return;
      }
      expect(finalizeResult.structured).toMatchObject({
        code: 'WRITE_FILE_FINALIZE_OK',
        message:
          'Buffered write finalized to the target file. Do not continue this document with write_file, because a new write_file call on the same path will overwrite the file. If further changes are needed, use edit_file or an explicit append operation.',
        nextAction: 'none',
      });
      expect(await fs.readFile(targetFile, 'utf8')).toBe(largeContent);
    } finally {
      await fs.rm(bufferDir, { recursive: true, force: true });
    }
  });

  it('returns recoverable EDIT_CONFLICT metadata when file_edit cannot anchor an edit', async () => {
    const targetFile = path.join(workspaceDir, 'conflict.txt');
    await fs.writeFile(targetFile, 'alpha\nbeta\n', 'utf8');

    const result = await system.execute(
      {
        toolCallId: 'edit-conflict',
        toolName: 'file_edit',
        arguments: JSON.stringify({
          path: targetFile,
          edits: [
            {
              oldText: 'missing',
              newText: 'gamma',
            },
          ],
        }),
      },
      createContext(workspaceDir, sessionState)
    );

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.output).toContain('EDIT_CONFLICT');
    expect(result.error.errorCode).toBe('TOOL_V2_CONFLICT');
    expect(result.metadata).toMatchObject({
      conflict: true,
      recoverable: true,
      next_actions: ['read_file', 'file_edit'],
    });
  });

  it('returns validation errors to the model when write_file is called without a path in direct mode', async () => {
    const result = await system.execute(
      {
        toolCallId: 'write-missing-path',
        toolName: 'write_file',
        arguments: JSON.stringify({
          content: 'hello',
        }),
      },
      createContext(workspaceDir, sessionState)
    );

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.errorCode).toBe('TOOL_V2_INVALID_ARGUMENTS');
    expect(result.error.category).toBe('validation');
    expect(result.output).toContain('path is required for direct mode');
  });

  it('returns structured not_found errors when file history does not exist', async () => {
    const missingFile = path.join(workspaceDir, 'missing-history.txt');
    await fs.writeFile(missingFile, 'present file without history', 'utf8');

    const result = await system.execute(
      {
        toolCallId: 'restore-missing-history',
        toolName: 'file_history_restore',
        arguments: JSON.stringify({
          path: missingFile,
        }),
      },
      createContext(workspaceDir, sessionState)
    );

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.errorCode).toBe('TOOL_V2_RESOURCE_NOT_FOUND');
    expect(result.error.category).toBe('not_found');
    expect(result.output).toContain('No file history exists');
  });

  it('returns structured not_found errors when lsp targets a missing file', async () => {
    const lspSystem = new EnterpriseToolSystem([new LspToolV2()]);
    const result = await lspSystem.execute(
      {
        toolCallId: 'lsp-missing-file',
        toolName: 'lsp',
        arguments: JSON.stringify({
          operation: 'documentSymbols',
          filePath: path.join(workspaceDir, 'missing.ts'),
        }),
      },
      createContext(workspaceDir, new ToolSessionState())
    );

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.errorCode).toBe('TOOL_V2_RESOURCE_NOT_FOUND');
    expect(result.error.category).toBe('not_found');
    expect(result.output).toContain('Requested file was not found');
  });

  it('blocks localhost web_fetch targets even when network access is otherwise enabled', async () => {
    const webSystem = new EnterpriseToolSystem([new WebFetchToolV2()]);
    const result = await webSystem.execute(
      {
        toolCallId: 'web-local',
        toolName: 'web_fetch',
        arguments: JSON.stringify({
          url: 'http://127.0.0.1/test',
        }),
      },
      createContext(workspaceDir, new ToolSessionState(), {
        networkPolicy: {
          mode: 'enabled',
        },
      })
    );

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.output).toContain('Blocked address');
  });

  it('supports extractMode and truncation in web_fetch', async () => {
    const largeHtml = `<html><body>${'Hello World '.repeat(20)}</body></html>`;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get(name: string) {
          if (name === 'content-type') {
            return 'text/html';
          }
          return null;
        },
      },
      text: async () => largeHtml,
    });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);

    try {
      const webSystem = new EnterpriseToolSystem([new WebFetchToolV2()]);
      const result = await webSystem.execute(
        {
          toolCallId: 'web-html',
          toolName: 'web_fetch',
          arguments: JSON.stringify({
            url: 'https://example.com/page',
            extractMode: 'html',
            maxChars: 100,
          }),
        },
        createContext(workspaceDir, new ToolSessionState(), {
          networkPolicy: {
            mode: 'enabled',
            allowedHosts: ['example.com'],
          },
        })
      );

      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.output).toContain('Extracted: html');
      expect(result.output).toContain('[... truncated ...]');
      expect(result.structured).toMatchObject({
        extractMode: 'html',
        truncated: true,
      });
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });
});

function createContext(
  workspaceDir: string,
  sessionState: ToolSessionState,
  overrides: Partial<Omit<ToolExecutionContext, 'authorization'>> & {
    approve?: ToolExecutionContext['authorization']['requestApproval'];
    requestPermissions?: ToolExecutionContext['authorization']['requestPermissions'];
    onPolicyCheck?: ToolExecutionContext['authorization']['evaluatePolicy'];
  } = {}
): ToolExecutionContext {
  const { approve, requestPermissions, onPolicyCheck, ...contextOverrides } = overrides;
  return {
    workingDirectory: workspaceDir,
    sessionState,
    authorization: {
      service: new AuthorizationService(),
      principal: createSystemPrincipal('tool-v2-tool-system-test'),
      requestApproval:
        approve ||
        (async () => ({
          approved: true,
          scope: 'turn',
        })),
      requestPermissions,
      evaluatePolicy: onPolicyCheck,
    },
    fileSystemPolicy: createWorkspaceFileSystemPolicy(workspaceDir),
    networkPolicy: createRestrictedNetworkPolicy(),
    approvalPolicy: 'on-request',
    ...contextOverrides,
  };
}
