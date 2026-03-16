import { z } from 'zod';
import type { ToolExecutionContext } from '../context';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import { ToolV2AbortError, ToolV2ExecutionError, ToolV2PermissionError } from '../errors';
import { arraySchema, numberSchema, objectSchema, stringSchema } from '../output-schema';
import { assertNetworkAccess } from '../permissions';
import { StructuredToolHandler } from '../registry';
import { WEB_SEARCH_TOOL_DESCRIPTION } from '../tool-prompts';

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const DEFAULT_TIMEOUT_MS = 30_000;

const schema = z
  .object({
    query: z.string().min(1).max(500).describe('Search query'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe('Maximum number of results to return'),
    provider: z
      .enum(['tavily', 'brave', 'auto'])
      .optional()
      .describe('Search provider to use, or auto to choose the first configured provider'),
  })
  .strict();

interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly score?: number;
}

interface SearchResponse {
  readonly query: string;
  readonly provider: string;
  readonly results: SearchResult[];
}

export class WebSearchToolV2 extends StructuredToolHandler<typeof schema> {
  constructor() {
    super({
      name: 'web_search',
      description: WEB_SEARCH_TOOL_DESCRIPTION,
      schema,
      outputSchema: objectSchema(
        {
          query: stringSchema(),
          provider: stringSchema(),
          results: arraySchema(
            objectSchema(
              {
                title: stringSchema(),
                url: stringSchema(),
                snippet: stringSchema(),
                score: numberSchema(),
              },
              {
                required: ['title', 'url', 'snippet'],
              }
            )
          ),
        },
        {
          required: ['query', 'provider', 'results'],
        }
      ),
      supportsParallel: true,
      mutating: false,
      tags: ['network', 'search'],
    });
  }

  plan(args: z.infer<typeof schema>): ToolExecutionPlan {
    const provider = resolveProvider(args.provider || 'auto');
    return {
      mutating: false,
      networkTargets: [provider === 'tavily' ? TAVILY_ENDPOINT : BRAVE_ENDPOINT],
    };
  }

  async execute(
    args: z.infer<typeof schema>,
    context: ToolExecutionContext
  ): Promise<ToolHandlerResult> {
    const provider = resolveProvider(args.provider || 'auto');
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, DEFAULT_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    context.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response =
        provider === 'tavily'
          ? await searchWithTavily(
              args.query,
              args.maxResults ?? 5,
              assertNetworkAccess(TAVILY_ENDPOINT, context.networkPolicy),
              controller.signal
            )
          : await searchWithBrave(
              args.query,
              args.maxResults ?? 5,
              assertNetworkAccess(BRAVE_ENDPOINT, context.networkPolicy),
              controller.signal
            );
      return {
        output: formatSearchOutput(response),
        structured: response,
        metadata: {
          provider: response.provider,
          resultCount: response.results.length,
        },
      };
    } catch (error) {
      if (error instanceof ToolV2AbortError && timedOut) {
        throw new ToolV2ExecutionError(`Web search timed out after ${DEFAULT_TIMEOUT_MS}ms`, {
          provider,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      context.signal?.removeEventListener('abort', onAbort);
    }
  }
}

function resolveProvider(provider: 'tavily' | 'brave' | 'auto'): 'tavily' | 'brave' {
  if (provider !== 'auto') {
    return provider;
  }
  if (process.env.TAVILY_API_KEY) {
    return 'tavily';
  }
  if (process.env.BRAVE_SEARCH_API_KEY) {
    return 'brave';
  }
  throw new ToolV2ExecutionError(
    'No search provider is configured. Set TAVILY_API_KEY or BRAVE_SEARCH_API_KEY.'
  );
}

async function searchWithTavily(
  query: string,
  maxResults: number,
  endpoint: URL,
  signal: AbortSignal
): Promise<SearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new ToolV2ExecutionError('TAVILY_API_KEY environment variable is not set');
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
        search_depth: 'basic',
        include_answer: false,
        include_raw_content: false,
      }),
    });
  } catch (error) {
    throw normalizeSearchError(error, 'tavily');
  }

  if (!response.ok) {
    throw new ToolV2ExecutionError(`Tavily API error: ${response.status} ${response.statusText}`, {
      provider: 'tavily',
      status: response.status,
    });
  }

  const data = (await response.json()) as {
    query?: string;
    results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
  };

  return {
    query: data.query || query,
    provider: 'tavily',
    results: (data.results || []).map((entry) => ({
      title: entry.title || 'No title',
      url: entry.url || '',
      snippet: entry.content || '',
      score: entry.score,
    })),
  };
}

async function searchWithBrave(
  query: string,
  maxResults: number,
  endpoint: URL,
  signal: AbortSignal
): Promise<SearchResponse> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    throw new ToolV2ExecutionError('BRAVE_SEARCH_API_KEY environment variable is not set');
  }

  const url = new URL(endpoint);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(maxResults));

  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
        'X-Subscription-Token': apiKey,
      },
    });
  } catch (error) {
    throw normalizeSearchError(error, 'brave');
  }

  if (!response.ok) {
    throw new ToolV2ExecutionError(
      `Brave Search API error: ${response.status} ${response.statusText}`,
      {
        provider: 'brave',
        status: response.status,
      }
    );
  }

  const data = (await response.json()) as {
    query?: { original?: string };
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };

  return {
    query: data.query?.original || query,
    provider: 'brave',
    results: (data.web?.results || []).map((entry) => ({
      title: entry.title || 'No title',
      url: entry.url || '',
      snippet: entry.description || '',
    })),
  };
}

function normalizeSearchError(error: unknown, provider: 'tavily' | 'brave'): Error {
  if (error instanceof ToolV2ExecutionError || error instanceof ToolV2PermissionError) {
    return error;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new ToolV2AbortError('Web search request aborted', {
      provider,
    });
  }
  return new ToolV2ExecutionError(
    `Web search failed: ${error instanceof Error ? error.message : String(error)}`,
    {
      provider,
    }
  );
}

function formatSearchOutput(response: SearchResponse): string {
  const lines: string[] = [
    `Search: "${response.query}"`,
    `Provider: ${response.provider}`,
    `Results: ${response.results.length}`,
    '',
  ];

  for (let index = 0; index < response.results.length; index += 1) {
    const result = response.results[index];
    lines.push(`[${index + 1}] ${result.title}`);
    lines.push(`    URL: ${result.url}`);
    if (result.score !== undefined) {
      lines.push(`    Score: ${result.score.toFixed(2)}`);
    }
    if (result.snippet) {
      lines.push(
        `    ${result.snippet.length > 300 ? `${result.snippet.slice(0, 300)}...` : result.snippet}`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}
