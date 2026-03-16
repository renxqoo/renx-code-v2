import { z } from 'zod';
import type { ToolExecutionContext } from '../context';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import { ToolV2ExecutionError, ToolV2PermissionError } from '../errors';
import { booleanSchema, integerSchema, objectSchema, stringSchema } from '../output-schema';
import { assertNetworkAccess } from '../permissions';
import { StructuredToolHandler } from '../registry';
import { WEB_FETCH_TOOL_DESCRIPTION } from '../tool-prompts';

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^(metadata\.google\.internal|metadata\.azure|169\.254\.169\.254)$/i,
];

const schema = z
  .object({
    url: z.string().url().describe('HTTP or HTTPS URL to fetch'),
    extractMode: z
      .enum(['text', 'markdown', 'html'])
      .optional()
      .describe('Response extraction mode: plain text, markdown-style text, or raw HTML'),
    maxChars: z
      .number()
      .int()
      .min(100)
      .max(100000)
      .optional()
      .describe('Maximum number of characters to return after extraction'),
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(120000)
      .optional()
      .describe('Request timeout in milliseconds'),
  })
  .strict();

export class WebFetchToolV2 extends StructuredToolHandler<typeof schema> {
  constructor() {
    super({
      name: 'web_fetch',
      description: WEB_FETCH_TOOL_DESCRIPTION,
      schema,
      outputSchema: objectSchema(
        {
          url: stringSchema(),
          contentType: stringSchema(),
          extractMode: stringSchema(),
          truncated: booleanSchema(),
          originalLength: integerSchema(),
          returnedLength: integerSchema(),
        },
        {
          required: [
            'url',
            'contentType',
            'extractMode',
            'truncated',
            'originalLength',
            'returnedLength',
          ],
        }
      ),
      supportsParallel: true,
      mutating: false,
      tags: ['network', 'read'],
    });
  }

  plan(args: z.infer<typeof schema>): ToolExecutionPlan {
    return {
      mutating: false,
      networkTargets: [args.url],
    };
  }

  async execute(
    args: z.infer<typeof schema>,
    context: ToolExecutionContext
  ): Promise<ToolHandlerResult> {
    const url = assertNetworkAccess(args.url, context.networkPolicy);
    assertPublicNetworkTarget(url);
    const controller = new AbortController();
    const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'renx-tool-v2/1.0',
          Accept: 'text/html,text/plain,application/json,*/*',
        },
      });
      if (!response.ok) {
        throw new ToolV2ExecutionError(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength && Number.parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
        throw new ToolV2ExecutionError(
          `Response too large: ${contentLength} bytes exceeds limit of ${MAX_RESPONSE_SIZE}`,
          {
            url: url.toString(),
            limitBytes: MAX_RESPONSE_SIZE,
          }
        );
      }

      const contentType = response.headers.get('content-type') || '';
      let body = await response.text();
      if (body.length > MAX_RESPONSE_SIZE) {
        body = body.slice(0, MAX_RESPONSE_SIZE);
      }

      const extractMode = args.extractMode || 'text';
      const text = extractMode === 'html' ? body : htmlToText(body);
      const limit = args.maxChars ?? 30000;
      const truncated = text.length > limit;
      const content = truncated ? `${text.slice(0, limit)}\n\n[... truncated ...]` : text;
      const output = `URL: ${url.toString()}\nContent-Type: ${contentType}\nExtracted: ${extractMode}\n${truncated ? '(Content truncated)\n' : ''}\n${content}`;
      return {
        output,
        structured: {
          url: url.toString(),
          contentType,
          extractMode,
          truncated,
          originalLength: text.length,
          returnedLength: output.length,
        },
        metadata: {
          contentType,
          extractMode,
          truncated,
        },
      };
    } catch (error) {
      if (error instanceof ToolV2ExecutionError || error instanceof ToolV2PermissionError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ToolV2ExecutionError(`Request timeout after ${timeoutMs}ms`, {
          url: url.toString(),
          timeoutMs,
        });
      }
      throw new ToolV2ExecutionError(
        `Fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          url: url.toString(),
        }
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function assertPublicNetworkTarget(url: URL): void {
  const hostname = url.hostname.toLowerCase();
  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new ToolV2PermissionError(`Blocked address: ${hostname}`, {
        host: hostname,
        url: url.toString(),
      });
    }
  }
}

function htmlToText(input: string): string {
  return input
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
