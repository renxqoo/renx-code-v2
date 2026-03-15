import { createHash } from 'node:crypto';

import type { AgentInput } from '../types';

function normalizeValueForHash(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValueForHash(item));
  }
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        const normalized = normalizeValueForHash((value as Record<string, unknown>)[key]);
        if (normalized !== undefined) {
          acc[key] = normalized;
        }
        return acc;
      }, {});
  }
  return String(value);
}

export function hashValueForContinuation(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(normalizeValueForHash(value)))
    .digest('hex');
}

export function normalizeContinuationConfig(config: AgentInput['config']): Record<string, unknown> {
  if (!config) {
    return {};
  }

  const { abortSignal, previous_response_id, ...rest } = config as AgentInput['config'] & {
    abortSignal?: AbortSignal;
    previous_response_id?: string;
  };
  void abortSignal;
  void previous_response_id;

  return normalizeValueForHash(rest) as Record<string, unknown>;
}
