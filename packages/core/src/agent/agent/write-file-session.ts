import type { ToolCall } from '../../providers';
import {
  appendContent,
  appendRawArgs,
  cleanupWriteBufferSessionFiles,
  createWriteBufferSession,
  loadWriteBufferSession,
  setWriteBufferSessionTargetPath,
  type WriteBufferSessionMeta,
} from './write-buffer';

export const WRITE_FILE_TOOL_NAME = 'write_file';

export interface WriteBufferRuntime {
  session: WriteBufferSessionMeta;
  bufferedContentChars: number;
}

interface WriteFileProtocolPayload {
  ok: boolean;
  code:
    | 'OK'
    | 'WRITE_FILE_PARTIAL_BUFFERED'
    | 'WRITE_FILE_NEED_FINALIZE'
    | 'WRITE_FILE_FINALIZE_OK';
  nextAction: 'finalize' | 'none';
  message?: string;
  buffer?: {
    bufferId: string;
    path: string;
    bufferedBytes: number;
    maxChunkBytes: number;
  };
  nextArgs?: {
    mode: 'finalize';
    bufferId: string;
    path?: string;
  };
}

interface ExtractedJsonStringField {
  value: string;
  terminated: boolean;
}

export function buildWriteFileSessionKey(params: {
  executionId?: string;
  stepIndex: number;
  toolCallId: string;
}): string {
  const { executionId, stepIndex, toolCallId } = params;
  const executionKey = executionId && executionId.trim().length > 0 ? executionId : '__anonymous__';
  return `${executionKey}:${stepIndex}:${toolCallId}`;
}

export function isWriteFileToolCall(toolCall: ToolCall): boolean {
  return toolCall.function.name?.trim() === WRITE_FILE_TOOL_NAME;
}

export function extractJsonStringFieldPrefix(
  argumentsText: string,
  fieldName: string
): ExtractedJsonStringField | null {
  const contentMarkerMatch = new RegExp(`"${fieldName}"\\s*:\\s*"`, 'm').exec(argumentsText);
  if (!contentMarkerMatch || typeof contentMarkerMatch.index !== 'number') {
    return null;
  }

  let cursor = contentMarkerMatch.index + contentMarkerMatch[0].length;
  let output = '';

  while (cursor < argumentsText.length) {
    const ch = argumentsText[cursor];
    if (ch === '"') {
      return {
        value: output,
        terminated: true,
      };
    }

    if (ch !== '\\') {
      output += ch;
      cursor += 1;
      continue;
    }

    if (cursor + 1 >= argumentsText.length) {
      return {
        value: output,
        terminated: false,
      };
    }

    const esc = argumentsText[cursor + 1];
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
      const unicodeHex = argumentsText.slice(cursor + 2, cursor + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(unicodeHex)) {
        return {
          value: output,
          terminated: false,
        };
      }
      output += String.fromCharCode(parseInt(unicodeHex, 16));
      cursor += 6;
    } else {
      output += esc;
      cursor += 2;
    }
  }

  return {
    value: output,
    terminated: false,
  };
}

export function extractWriteFileContentPrefix(argumentsText: string): string | null {
  return extractJsonStringFieldPrefix(argumentsText, 'content')?.value ?? null;
}

export async function bufferWriteFileToolCallChunk(params: {
  toolCall: ToolCall;
  argumentsChunk: string;
  messageId: string;
  sessionKey?: string;
  sessions: Map<string, WriteBufferRuntime>;
  onError?: (error: unknown) => void;
}): Promise<void> {
  const { toolCall, argumentsChunk, messageId, sessionKey, sessions, onError } = params;
  if (!isWriteFileToolCall(toolCall)) {
    return;
  }

  try {
    const runtimeKey = sessionKey || toolCall.id;
    let runtime = sessions.get(runtimeKey);
    if (!runtime) {
      const session = await createWriteBufferSession({
        messageId,
        toolCallId: toolCall.id,
      });
      runtime = {
        session,
        bufferedContentChars: 0,
      };
      sessions.set(runtimeKey, runtime);
    }

    if (argumentsChunk) {
      await appendRawArgs(runtime.session, argumentsChunk);
    }

    const extractedPath = extractJsonStringFieldPrefix(toolCall.function.arguments, 'path');
    if (
      extractedPath?.terminated &&
      extractedPath.value.trim().length > 0 &&
      runtime.session.targetPath !== extractedPath.value
    ) {
      await setWriteBufferSessionTargetPath(runtime.session, extractedPath.value);
      runtime.session.targetPath = extractedPath.value;
    }

    const decodedContentPrefix = extractWriteFileContentPrefix(toolCall.function.arguments);
    if (decodedContentPrefix === null) {
      return;
    }

    if (decodedContentPrefix.length <= runtime.bufferedContentChars) {
      return;
    }

    const contentDelta = decodedContentPrefix.slice(runtime.bufferedContentChars);
    await appendContent(runtime.session, contentDelta);
    runtime.bufferedContentChars = decodedContentPrefix.length;
  } catch (error) {
    onError?.(error);
  }
}

export async function enrichWriteFileToolError(
  toolCall: ToolCall,
  content: string,
  sessions: Map<string, WriteBufferRuntime>,
  sessionKey?: string
): Promise<string> {
  if (!isWriteFileToolCall(toolCall)) {
    return content;
  }
  const runtime = sessions.get(sessionKey || toolCall.id);
  if (!runtime) {
    return JSON.stringify({
      ok: false,
      code: 'WRITE_FILE_NEED_FINALIZE',
      message: content,
      nextAction: 'finalize',
    });
  }
  try {
    const meta = await loadWriteBufferSession(runtime.session.metaPath);
    const extractedPath = extractJsonStringFieldPrefix(toolCall.function.arguments, 'path');
    const resolvedPath =
      meta.targetPath ||
      (extractedPath?.terminated && extractedPath.value.trim().length > 0
        ? extractedPath.value
        : undefined);
    if (resolvedPath && meta.targetPath !== resolvedPath) {
      await setWriteBufferSessionTargetPath(runtime.session, resolvedPath);
      meta.targetPath = resolvedPath;
    }
    return JSON.stringify({
      ok: false,
      code: 'WRITE_FILE_PARTIAL_BUFFERED',
      message: content,
      buffer: {
        bufferId: meta.bufferId,
        path: meta.targetPath || '',
        bufferedBytes: meta.contentBytes,
        maxChunkBytes: 32768,
      },
      nextArgs: {
        mode: 'finalize',
        bufferId: meta.bufferId,
        ...(meta.targetPath ? { path: meta.targetPath } : {}),
      },
      nextAction: 'finalize',
    });
  } catch {
    return JSON.stringify({
      ok: false,
      code: 'WRITE_FILE_NEED_FINALIZE',
      message: content,
      nextAction: 'finalize',
    });
  }
}

export function isWriteFileProtocolOutput(content: string | undefined): content is string {
  if (!content || content.trim().length === 0) {
    return false;
  }
  try {
    const parsed = JSON.parse(content) as Partial<WriteFileProtocolPayload>;
    if (!parsed || typeof parsed !== 'object') {
      return false;
    }
    return (
      typeof parsed.code === 'string' &&
      typeof parsed.ok === 'boolean' &&
      (parsed.nextAction === 'finalize' || parsed.nextAction === 'none')
    );
  } catch {
    return false;
  }
}

export function parseWriteFileProtocolOutput(
  content: string | undefined
): WriteFileProtocolPayload | null {
  if (!isWriteFileProtocolOutput(content)) {
    return null;
  }
  try {
    return JSON.parse(content) as WriteFileProtocolPayload;
  } catch {
    return null;
  }
}

export function shouldEnrichWriteFileFailure(
  error: { name?: string } | undefined,
  output?: string
): boolean {
  if (isWriteFileProtocolOutput(output)) {
    return false;
  }
  const errorName = error?.name;
  return errorName === 'InvalidArgumentsError' || errorName === 'ToolValidationError';
}

export async function cleanupWriteFileBufferIfNeeded(
  toolCall: ToolCall,
  sessions: Map<string, WriteBufferRuntime>,
  sessionKey?: string
): Promise<void> {
  if (!isWriteFileToolCall(toolCall)) {
    return;
  }
  const runtimeKey = sessionKey || toolCall.id;
  const runtime = sessions.get(runtimeKey);
  if (!runtime) {
    return;
  }
  sessions.delete(runtimeKey);
  await cleanupWriteBufferSessionFiles(runtime.session);
}
