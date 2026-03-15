import type { Message } from '../types';

export type ContinuationMetadata = {
  responseId?: string;
  llmRequestConfigHash?: string;
  llmRequestInputHash?: string;
  llmRequestInputMessageCount?: number;
  llmResponseMessageHash?: string;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readContinuationMetadata(message: Message): ContinuationMetadata | undefined {
  if (!isPlainRecord(message.metadata)) {
    return undefined;
  }

  const metadata = message.metadata as Record<string, unknown>;
  const responseId =
    typeof metadata.responseId === 'string' && metadata.responseId.trim().length > 0
      ? metadata.responseId
      : undefined;
  const llmRequestConfigHash =
    typeof metadata.llmRequestConfigHash === 'string' ? metadata.llmRequestConfigHash : undefined;
  const llmRequestInputHash =
    typeof metadata.llmRequestInputHash === 'string' ? metadata.llmRequestInputHash : undefined;
  const llmRequestInputMessageCount =
    typeof metadata.llmRequestInputMessageCount === 'number'
      ? metadata.llmRequestInputMessageCount
      : undefined;
  const llmResponseMessageHash =
    typeof metadata.llmResponseMessageHash === 'string'
      ? metadata.llmResponseMessageHash
      : undefined;

  if (
    !responseId ||
    !llmRequestConfigHash ||
    !llmRequestInputHash ||
    typeof llmRequestInputMessageCount !== 'number' ||
    !Number.isInteger(llmRequestInputMessageCount) ||
    llmRequestInputMessageCount < 0 ||
    !llmResponseMessageHash
  ) {
    return undefined;
  }

  return {
    responseId,
    llmRequestConfigHash,
    llmRequestInputHash,
    llmRequestInputMessageCount,
    llmResponseMessageHash,
  };
}
