import { StreamParser } from '../http/stream-parser';
import type { Chunk, LLMRequest, LLMResponse, LLMResponseMessage } from '../types';
import { StandardAdapter } from './standard';

interface MiniMaxReasoningDetail {
  type?: string;
  text?: string;
}

function extractReasoningText(details: unknown): string | undefined {
  if (!Array.isArray(details)) {
    return undefined;
  }

  const text = details
    .filter(
      (detail): detail is MiniMaxReasoningDetail =>
        Boolean(detail) && typeof detail === 'object' && typeof detail.text === 'string'
    )
    .map((detail) => detail.text)
    .join('');

  return text.length > 0 ? text : undefined;
}

function getIncrementalText(next: string, previous: string): string {
  if (!previous) {
    return next;
  }

  return next.startsWith(previous) ? next.slice(previous.length) : next;
}

/**
 * MiniMax API 适配器
 *
 * 当启用 thinking 时，按 MiniMax OpenAI-compatible 扩展发送：
 * `reasoning_split: true`
 */
export class MiniMaxAdapter extends StandardAdapter {
  constructor(options: { endpointPath?: string; defaultModel?: string } = {}) {
    super(options);
  }

  transformRequest(options?: LLMRequest): Record<string, unknown> {
    const body = super.transformRequest(options);

    if (options?.thinking === false) {
      delete body.reasoning_split;
      delete body.extra_body;
      return body;
    }

    body.reasoning_split = true;
    delete body.extra_body;

    return body;
  }

  transformResponse(response: Record<string, unknown>): LLMResponse {
    const data = super.transformResponse(response);

    return {
      ...data,
      choices: data.choices.map((choice) => {
        const message = choice.message as LLMResponseMessage & {
          reasoning_details?: unknown;
        };
        const reasoningContent = extractReasoningText(message.reasoning_details);

        if (!reasoningContent || message.reasoning_content) {
          return choice;
        }

        return {
          ...choice,
          message: {
            ...message,
            reasoning_content: reasoningContent,
          },
        };
      }),
    };
  }

  async *parseStreamAsync(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<Chunk> {
    const previousReasoningByChoice = new Map<number, string>();
    const previousContentByChoice = new Map<number, string>();

    for await (const chunk of StreamParser.parseAsync(reader)) {
      if (!chunk.choices || chunk.choices.length === 0) {
        yield chunk;
        continue;
      }

      yield {
        ...chunk,
        choices: chunk.choices.map((choice, choiceArrayIndex) => {
          const delta = (choice.delta ?? {}) as LLMResponseMessage & {
            reasoning_details?: unknown;
          };
          const choiceKey = choice.index ?? choiceArrayIndex;
          const nextReasoning = extractReasoningText(delta.reasoning_details);
          const previousReasoning = previousReasoningByChoice.get(choiceKey) ?? '';
          const nextContent = typeof delta.content === 'string' ? delta.content : undefined;
          const previousContent = previousContentByChoice.get(choiceKey) ?? '';

          const transformedDelta: LLMResponseMessage = {
            ...delta,
          };

          delete transformedDelta.reasoning_details;

          if (nextReasoning !== undefined) {
            transformedDelta.reasoning_content = getIncrementalText(
              nextReasoning,
              previousReasoning
            );
            previousReasoningByChoice.set(choiceKey, nextReasoning);
          }

          if (nextContent !== undefined) {
            transformedDelta.content = getIncrementalText(nextContent, previousContent);
            previousContentByChoice.set(choiceKey, nextContent);
          }

          return {
            ...choice,
            delta: transformedDelta,
          };
        }),
      };
    }
  }
}
