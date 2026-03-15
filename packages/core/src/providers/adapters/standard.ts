import type { LLMRequest, LLMResponse } from '../types';
import { BaseAPIAdapter } from './base';

export interface StandardTransformOptions extends LLMRequest {
  defaultModel?: string;
}

function normalizeSystemValue(value: unknown): string | string[] | undefined {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  if (Array.isArray(value)) {
    const normalized = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    return normalized.length > 0 ? normalized : undefined;
  }

  return undefined;
}

export class StandardAdapter extends BaseAPIAdapter {
  readonly endpointPath: string;
  readonly defaultModel: string;

  constructor(options: { endpointPath?: string; defaultModel?: string } = {}) {
    super();
    this.endpointPath = options.endpointPath ?? '/chat/completions';
    this.defaultModel = options.defaultModel ?? 'gpt-4o';
  }

  transformRequest(options?: LLMRequest): Record<string, unknown> {
    const {
      model,
      max_tokens,
      messages,
      temperature,
      stream,
      tool_stream,
      tools,
      system,
      thinking,
      abortSignal,
      ...rest
    } = options || ({} as LLMRequest & { abortSignal?: AbortSignal; thinking?: unknown });
    void thinking;
    void abortSignal;

    const extras = Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== undefined)
    );

    const body: LLMRequest = {
      ...extras,
      model: model || this.defaultModel,
      messages: this.cleanMessage(messages || []),
      max_tokens,
      temperature,
      stream: stream ?? false,
    };

    if (tool_stream !== undefined) {
      body.tool_stream = tool_stream;
    }

    const normalizedSystem = normalizeSystemValue(system);
    if (normalizedSystem !== undefined) {
      body.system = normalizedSystem;
    }

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    return this.enrichRequestBody(body, options);
  }

  protected enrichRequestBody(
    body: LLMRequest,
    _options?: StandardTransformOptions
  ): Record<string, unknown> {
    return body;
  }

  transformResponse(response: Record<string, unknown>): LLMResponse {
    const data = response as LLMResponse;

    if (!data.choices || data.choices.length === 0) {
      const responseStr = JSON.stringify(response, null, 2);
      throw new Error(`Empty choices in response. Response: ${responseStr}`);
    }

    return data;
  }

  getHeaders(apiKey: string): Headers {
    return new Headers({
      'Content-Type': 'application/json',
      'User-Agent': 'RCode/1.0.0(cli)',
      Authorization: `Bearer ${apiKey}`,
    });
  }

  getEndpointPath(): string {
    return this.endpointPath;
  }
}
