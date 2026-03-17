export type ParsedToolResultLike = {
  details?: string;
  summary?: string;
  output?: string;
  payload?: unknown;
  metadata?: unknown;
};

const readObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const readString = (value: unknown): string | undefined => {
  return typeof value === 'string' ? value : undefined;
};

const stringifyPretty = (value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return undefined;
  }
};

const readStructuredBodyText = (value: unknown): string | undefined => {
  const objectValue = readObject(value);
  if (!objectValue) {
    return typeof value === 'string' ? value : undefined;
  }

  const directText =
    readString(objectValue.content) ??
    readString(objectValue.text) ??
    readString(objectValue.output) ??
    readString(objectValue.message) ??
    readString(objectValue.body);
  if (directText && directText.trim().length > 0) {
    return directText;
  }

  return undefined;
};

export const resolveToolResultFallbackText = (
  result: ParsedToolResultLike | null | undefined
): string | undefined => {
  if (!result) {
    return undefined;
  }

  const payloadText = readStructuredBodyText(result.payload);
  if (payloadText && payloadText.trim().length > 0) {
    return payloadText;
  }

  const metadataText = readStructuredBodyText(result.metadata);
  if (metadataText && metadataText.trim().length > 0) {
    return metadataText;
  }

  const payloadObject = readObject(result.payload);
  if (payloadObject) {
    return stringifyPretty(payloadObject);
  }

  const metadataObject = readObject(result.metadata);
  if (metadataObject) {
    return stringifyPretty(metadataObject);
  }

  return undefined;
};
