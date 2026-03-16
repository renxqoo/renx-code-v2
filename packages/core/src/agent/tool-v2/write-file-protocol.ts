export type WriteFileProtocolCode =
  | 'OK'
  | 'WRITE_FILE_PARTIAL_BUFFERED'
  | 'WRITE_FILE_NEED_FINALIZE'
  | 'WRITE_FILE_FINALIZE_OK';

export interface WriteFileBufferInfo {
  readonly bufferId: string;
  readonly path: string;
  readonly bufferedBytes: number;
  readonly maxChunkBytes: number;
}

export interface WriteFileProtocolPayload {
  readonly ok: boolean;
  readonly code: WriteFileProtocolCode;
  readonly message?: string;
  readonly buffer?: WriteFileBufferInfo;
  readonly nextArgs?: {
    readonly mode: 'finalize';
    readonly bufferId: string;
    readonly path?: string;
  };
  readonly nextAction: 'finalize' | 'none';
}

export function isWriteFileProtocolPayload(value: unknown): value is WriteFileProtocolPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const payload = value as Partial<WriteFileProtocolPayload>;
  return (
    typeof payload.ok === 'boolean' &&
    typeof payload.code === 'string' &&
    (payload.message === undefined || typeof payload.message === 'string') &&
    (payload.nextAction === 'finalize' || payload.nextAction === 'none')
  );
}

export function parseWriteFileProtocolOutput(
  output: string | undefined
): WriteFileProtocolPayload | null {
  if (!output || output.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(output) as unknown;
    return isWriteFileProtocolPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
