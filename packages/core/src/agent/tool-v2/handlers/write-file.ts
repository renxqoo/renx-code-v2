import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import type { ToolExecutionContext } from '../context';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import { ToolV2ConflictError } from '../errors';
import { writeFileProtocolSchema } from '../output-schema';
import { assertWriteAccess } from '../permissions';
import { StructuredToolHandler } from '../registry';
import type { FileHistoryStore } from '../../storage/file-history-store';
import { createConfiguredFileHistoryStore } from '../../storage/file-history-store';
import {
  getWriteBufferCandidateDirs,
  resolveWriteBufferBaseDir,
} from '../../storage/file-storage-config';
import { writeTextFileWithHistory } from '../../storage/file-write-service';
import {
  appendContent,
  cleanupWriteBufferSessionFiles,
  createWriteBufferSession,
  finalizeWriteBufferSession,
  loadWriteBufferSession,
} from '../../agent/write-buffer';
import { WRITE_FILE_TOOL_DESCRIPTION } from '../tool-prompts';
import type { WriteFileProtocolPayload } from '../write-file-protocol';

const schema = z
  .object({
    path: z
      .string()
      .min(1)
      .optional()
      .describe('Target path. Required for direct mode and optional for finalize'),
    content: z.string().optional().describe('Plain text content chunk for this call'),
    mode: z
      .enum(['direct', 'finalize'])
      .optional()
      .describe('Write mode: direct writes immediately, finalize flushes a buffered session'),
    bufferId: z
      .string()
      .min(1)
      .optional()
      .describe('Buffered write session identifier used for finalize'),
  })
  .strict()
  .superRefine((value, ctx) => {
    const mode = value.mode || 'direct';
    if (mode === 'direct' && !value.path) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'path is required for direct mode',
        path: ['path'],
      });
    }
  });

interface SessionPointer {
  readonly metaPath: string;
}

interface LoadedBufferSession {
  readonly session: {
    contentPath: string;
    metaPath: string;
    rawArgsPath: string;
    targetPath?: string;
    bufferId: string;
    contentBytes: number;
  };
}

export interface WriteFileToolV2Options {
  readonly maxChunkBytes?: number;
  readonly bufferBaseDir?: string;
  readonly historyStore?: FileHistoryStore;
}

export class WriteFileToolV2 extends StructuredToolHandler<typeof schema> {
  private readonly maxChunkBytes: number;
  private readonly bufferBaseDir: string;
  private readonly historyStore: FileHistoryStore;

  constructor(options: WriteFileToolV2Options = {}) {
    super({
      name: 'write_file',
      description: WRITE_FILE_TOOL_DESCRIPTION,
      schema,
      outputSchema: writeFileProtocolSchema,
      supportsParallel: false,
      mutating: true,
      tags: ['filesystem', 'write'],
    });
    this.maxChunkBytes =
      options.maxChunkBytes && options.maxChunkBytes > 0 ? options.maxChunkBytes : 32768;
    this.bufferBaseDir = resolveWriteBufferBaseDir(options.bufferBaseDir);
    this.historyStore = options.historyStore ?? createConfiguredFileHistoryStore();
    fs.mkdirSync(this.bufferBaseDir, { recursive: true });
  }

  plan(args: z.infer<typeof schema>): ToolExecutionPlan {
    const mode = args.mode || 'direct';
    const approvalTarget = args.path || args.bufferId || 'buffered write';
    return {
      mutating: true,
      writePaths: args.path ? [args.path] : undefined,
      approval: {
        required: true,
        reason:
          mode === 'finalize'
            ? `Finalize buffered write ${approvalTarget}`
            : `Write file ${approvalTarget}`,
        key:
          mode === 'finalize' ? `write-file-finalize:${approvalTarget}` : `write:${approvalTarget}`,
      },
      preferredSandbox: 'workspace-write',
    };
  }

  async execute(
    args: z.infer<typeof schema>,
    context: ToolExecutionContext
  ): Promise<ToolHandlerResult> {
    const mode = args.mode || 'direct';
    if (mode === 'finalize') {
      return this.handleFinalize(args.path, args.bufferId, context);
    }

    const targetPath = assertWriteAccess(
      args.path as string,
      context.workingDirectory,
      context.fileSystemPolicy
    );
    return this.handleDirect(targetPath, args.content || '', context);
  }

  private async handleDirect(
    targetPath: string,
    content: string,
    context: ToolExecutionContext
  ): Promise<ToolHandlerResult> {
    const contentBytes = Buffer.byteLength(content, 'utf8');
    if (contentBytes <= this.maxChunkBytes) {
      await this.writeAtomically(targetPath, content);
      return this.protocolResult({
        ok: true,
        code: 'OK',
        message: 'File written successfully',
        nextAction: 'none',
      });
    }

    const session = await this.createOrLoadSession(
      targetPath,
      context.activeCall?.toolCallId,
      undefined,
      targetPath
    );
    await appendContent(session, content);
    const latest = await loadWriteBufferSession(session.metaPath);

    return this.protocolResult({
      ok: false,
      code: 'WRITE_FILE_PARTIAL_BUFFERED',
      message: `Buffered oversized content. Finalize with bufferId=${latest.bufferId}.`,
      buffer: {
        bufferId: latest.bufferId,
        path: targetPath,
        bufferedBytes: latest.contentBytes,
        maxChunkBytes: this.maxChunkBytes,
      },
      nextArgs: {
        mode: 'finalize',
        bufferId: latest.bufferId,
        path: targetPath,
      },
      nextAction: 'finalize',
    });
  }

  private async handleFinalize(
    inputPath: string | undefined,
    bufferId: string | undefined,
    context: ToolExecutionContext
  ): Promise<ToolHandlerResult> {
    if (!bufferId) {
      return this.protocolResult({
        ok: false,
        code: 'WRITE_FILE_NEED_FINALIZE',
        message: 'bufferId is required for finalize mode',
        nextAction: 'finalize',
      });
    }

    const loaded = await this.loadBufferedSession(bufferId);
    if (!loaded) {
      return this.protocolResult({
        ok: false,
        code: 'WRITE_FILE_NEED_FINALIZE',
        message: `Buffer session not found for bufferId=${bufferId}`,
        nextAction: 'finalize',
      });
    }

    const session = loaded.session;
    const targetPath = this.resolveFinalizeTargetPath(inputPath, session.targetPath, context);
    if (!targetPath) {
      return this.protocolResult({
        ok: false,
        code: 'WRITE_FILE_NEED_FINALIZE',
        message: 'path is required for finalize mode when buffer session has no target path',
        buffer: {
          bufferId: session.bufferId,
          path: inputPath || session.targetPath || '',
          bufferedBytes: session.contentBytes,
          maxChunkBytes: this.maxChunkBytes,
        },
        nextArgs: {
          mode: 'finalize',
          bufferId: session.bufferId,
        },
        nextAction: 'finalize',
      });
    }
    const normalizedSessionTargetPath = session.targetPath
      ? assertWriteAccess(session.targetPath, context.workingDirectory, context.fileSystemPolicy)
      : undefined;

    if (normalizedSessionTargetPath && normalizedSessionTargetPath !== targetPath) {
      return this.protocolResult({
        ok: false,
        code: 'WRITE_FILE_NEED_FINALIZE',
        message: 'Target path does not match existing buffer session',
        buffer: {
          bufferId: session.bufferId,
          path: normalizedSessionTargetPath,
          bufferedBytes: session.contentBytes,
          maxChunkBytes: this.maxChunkBytes,
        },
        nextArgs: {
          mode: 'finalize',
          bufferId: session.bufferId,
          path: normalizedSessionTargetPath,
        },
        nextAction: 'finalize',
      });
    }

    await finalizeWriteBufferSession({
      contentPath: session.contentPath,
      metaPath: session.metaPath,
      targetPath,
    });
    await cleanupWriteBufferSessionFiles(session);
    await this.removePointer(session.bufferId);

    return this.protocolResult({
      ok: true,
      code: 'WRITE_FILE_FINALIZE_OK',
      message: 'Buffered content finalized to target file',
      nextAction: 'none',
    });
  }

  private protocolResult(payload: WriteFileProtocolPayload): ToolHandlerResult {
    return {
      output: JSON.stringify(payload),
      structured: payload,
      metadata: {
        code: payload.code,
        nextAction: payload.nextAction,
        bufferId: payload.buffer?.bufferId || payload.nextArgs?.bufferId,
        path: payload.buffer?.path || payload.nextArgs?.path,
      },
    };
  }

  private async createOrLoadSession(
    targetPath: string,
    sessionSeedId?: string,
    explicitBufferId?: string,
    expectedTargetPath?: string
  ): Promise<{ contentPath: string; metaPath: string; rawArgsPath: string }> {
    if (explicitBufferId) {
      const loadedSession = await this.loadBufferedSession(explicitBufferId);
      if (loadedSession) {
        const loaded = loadedSession.session;
        if (
          expectedTargetPath &&
          loaded.targetPath &&
          path.resolve(loaded.targetPath) !== path.resolve(expectedTargetPath)
        ) {
          throw new ToolV2ConflictError('bufferId target path mismatch', {
            bufferId: explicitBufferId,
            expectedTargetPath,
            targetPath: loaded.targetPath,
          });
        }
        return loaded;
      }
    }

    const session = await createWriteBufferSession({
      messageId: `write_file_${Date.now()}`,
      toolCallId: explicitBufferId || sessionSeedId,
      targetPath,
      baseDir: this.bufferBaseDir,
    });
    await this.savePointer(session.bufferId, session.metaPath);
    return session;
  }

  private resolveFinalizeTargetPath(
    inputPath: string | undefined,
    sessionTargetPath: string | undefined,
    context: ToolExecutionContext
  ): string | undefined {
    if (inputPath) {
      return assertWriteAccess(inputPath, context.workingDirectory, context.fileSystemPolicy);
    }
    if (sessionTargetPath) {
      return assertWriteAccess(
        sessionTargetPath,
        context.workingDirectory,
        context.fileSystemPolicy
      );
    }
    return undefined;
  }

  private async writeAtomically(targetPath: string, content: string): Promise<void> {
    await writeTextFileWithHistory(targetPath, content, {
      source: 'tool-v2.write_file',
      historyStore: this.historyStore,
    });
  }

  private async savePointer(bufferId: string, metaPath: string): Promise<void> {
    const pointerPath = this.pointerPath(bufferId);
    const pointer: SessionPointer = { metaPath };
    await fs.promises.writeFile(pointerPath, JSON.stringify(pointer), 'utf8');
  }

  private async loadBufferedSession(bufferId: string): Promise<LoadedBufferSession | null> {
    for (const dir of this.getCandidateBufferDirs()) {
      const pointer = await this.readPointer(path.join(dir, this.pointerFileName(bufferId)));
      if (pointer) {
        const session = await loadWriteBufferSession(pointer.metaPath);
        return { session };
      }
    }

    const fallback = await this.findFallbackSessionByBufferId(bufferId);
    return fallback ? { session: fallback } : null;
  }

  private async findFallbackSessionByBufferId(bufferId: string): Promise<{
    contentPath: string;
    metaPath: string;
    rawArgsPath: string;
    targetPath?: string;
    bufferId: string;
    contentBytes: number;
  } | null> {
    const safeId = bufferId.replace(/[^a-zA-Z0-9_-]/g, '_');
    for (const dir of this.getCandidateBufferDirs()) {
      let entries: string[] = [];
      try {
        entries = await fs.promises.readdir(dir);
      } catch {
        continue;
      }

      const candidates = entries
        .filter((entry) => entry.endsWith('.meta.json') && entry.includes(safeId))
        .sort()
        .reverse();

      for (const entry of candidates) {
        try {
          const session = await loadWriteBufferSession(path.join(dir, entry));
          if (session.bufferId !== bufferId) {
            continue;
          }
          if (!session.targetPath) {
            const inferredTargetPath = await this.extractTargetPathFromRawArgs(session.rawArgsPath);
            if (inferredTargetPath) {
              session.targetPath = inferredTargetPath;
            }
          }
          return session;
        } catch {
          continue;
        }
      }
    }

    return null;
  }

  private async extractTargetPathFromRawArgs(rawArgsPath: string): Promise<string | undefined> {
    try {
      const rawArgs = await fs.promises.readFile(rawArgsPath, 'utf8');
      return this.extractJsonStringField(rawArgs, 'path');
    } catch {
      return undefined;
    }
  }

  private extractJsonStringField(raw: string, fieldName: string): string | undefined {
    const markerMatch = new RegExp(`"${fieldName}"\\s*:\\s*"`, 'm').exec(raw);
    if (!markerMatch || typeof markerMatch.index !== 'number') {
      return undefined;
    }

    let cursor = markerMatch.index + markerMatch[0].length;
    let output = '';

    while (cursor < raw.length) {
      const ch = raw[cursor];
      if (ch === '"') {
        return output;
      }
      if (ch !== '\\') {
        output += ch;
        cursor += 1;
        continue;
      }

      if (cursor + 1 >= raw.length) {
        return output;
      }

      const esc = raw[cursor + 1];
      if (esc === '"' || esc === '\\' || esc === '/') {
        output += esc;
        cursor += 2;
      } else if (esc === 'b') {
        output += '\b';
        cursor += 2;
      } else if (esc === 'f') {
        output += '\f';
        cursor += 2;
      } else if (esc === 'n') {
        output += '\n';
        cursor += 2;
      } else if (esc === 'r') {
        output += '\r';
        cursor += 2;
      } else if (esc === 't') {
        output += '\t';
        cursor += 2;
      } else if (esc === 'u') {
        const unicodeHex = raw.slice(cursor + 2, cursor + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(unicodeHex)) {
          return output;
        }
        output += String.fromCharCode(parseInt(unicodeHex, 16));
        cursor += 6;
      } else {
        output += esc;
        cursor += 2;
      }
    }

    return output || undefined;
  }

  private pointerPath(bufferId: string): string {
    return path.join(this.bufferBaseDir, this.pointerFileName(bufferId));
  }

  private pointerFileName(bufferId: string): string {
    const safeId = bufferId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${safeId}.pointer.json`;
  }

  private getCandidateBufferDirs(): string[] {
    return getWriteBufferCandidateDirs(this.bufferBaseDir);
  }

  private async readPointer(pointerPath: string): Promise<SessionPointer | null> {
    try {
      const content = await fs.promises.readFile(pointerPath, 'utf8');
      return JSON.parse(content) as SessionPointer;
    } catch {
      return null;
    }
  }

  private async removePointer(bufferId: string): Promise<void> {
    await Promise.all(
      this.getCandidateBufferDirs().map((dir) =>
        fs.promises.rm(path.join(dir, this.pointerFileName(bufferId)), { force: true })
      )
    );
  }
}
