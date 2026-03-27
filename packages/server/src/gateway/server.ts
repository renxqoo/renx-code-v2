import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { AgentAppService, SqliteAgentAppStore } from '@renx-code/core';

import type { ServerConfig } from '../config/schema';
import { authorizeGatewayRequest } from './auth';
import { createGatewayRequestContext } from './context';
import { errorResponse, HttpError } from './errors';
import {
  executeOpenAiChatCompletion,
  streamOpenAiChatCompletion,
  toOpenAiCompletionResponse,
} from './openai-http';
import { InMemoryRateLimiter } from './rate-limit';
import { handleHealth } from './routes/health';
import { appendRunInput, createRun, getRun, listConversationEvents, listRuns } from './routes/runs';
import { listSessions } from './routes/sessions';
import { openSse, writeSseData, writeSseDone } from './sse';

export function createGatewayServer(input: {
  appService: AgentAppService;
  store?: SqliteAgentAppStore;
  config: ServerConfig;
}) {
  const store = input.store;
  if (!store) {
    throw new Error('Gateway server requires a sqlite-backed store');
  }
  const rateLimiter = input.config.rateLimit
    ? new InMemoryRateLimiter(input.config.rateLimit)
    : undefined;

  return createServer(async (request, response) => {
    try {
      await routeRequest(request, response, {
        appService: input.appService,
        store,
        config: input.config,
        rateLimiter,
      });
    } catch (error) {
      const payload = errorResponse(error);
      response.writeHead(payload.statusCode, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(payload.body));
    }
  });
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  input: {
    appService: AgentAppService;
    store: SqliteAgentAppStore;
    config: ServerConfig;
    rateLimiter?: InMemoryRateLimiter;
  }
): Promise<void> {
  const method = request.method || 'GET';
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/health') {
    handleHealth(response);
    return;
  }

  const rateLimitResult = input.rateLimiter?.consume(request);
  if (rateLimitResult && !rateLimitResult.allowed) {
    response.writeHead(429, {
      'content-type': 'application/json; charset=utf-8',
      'retry-after': String(rateLimitResult.retryAfterSeconds ?? 1),
    });
    response.end(
      JSON.stringify({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
        },
      })
    );
    return;
  }

  const auth = authorizeGatewayRequest(request, input.config);
  if (!auth.ok) {
    response.writeHead(auth.statusCode, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: auth.error } }));
    return;
  }

  createGatewayRequestContext(request, auth.principal);

  if (method === 'POST' && pathname === '/api/runs') {
    const body = await readJsonBody(request);
    const result = await createRun(input.appService, body, auth.principal);
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(result));
    return;
  }

  if (method === 'GET' && pathname === '/api/runs') {
    const statuses = url.searchParams.getAll('status').filter(Boolean) as Array<
      'CREATED' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
    >;
    const result = await listRuns(input.appService, {
      conversationId: url.searchParams.get('conversationId') || undefined,
      limit: readInt(url.searchParams.get('limit')),
      statuses: statuses.length > 0 ? statuses : undefined,
    });
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(result));
    return;
  }

  const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (method === 'GET' && runMatch) {
    const result = await getRun(input.appService, decodeURIComponent(runMatch[1]));
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(result));
    return;
  }

  const appendMatch = pathname.match(/^\/api\/runs\/([^/]+)\/input$/);
  if (method === 'POST' && appendMatch) {
    const body = await readJsonBody(request);
    const result = await appendRunInput(input.appService, decodeURIComponent(appendMatch[1]), body);
    response.writeHead(result.accepted ? 202 : 409, {
      'content-type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify(result));
    return;
  }

  if (method === 'GET' && pathname === '/api/sessions') {
    const limit = readInt(url.searchParams.get('limit'));
    const result = await listSessions(input.store, { limit });
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(result));
    return;
  }

  const eventsMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/events$/);
  if (method === 'GET' && eventsMatch) {
    const result = await listConversationEvents(input.store, decodeURIComponent(eventsMatch[1]), {
      fromSeq: readInt(url.searchParams.get('fromSeq')),
      limit: readInt(url.searchParams.get('limit')),
    });
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(result));
    return;
  }

  if (method === 'POST' && pathname === '/v1/chat/completions') {
    if (!input.config.enableOpenAiCompat) {
      throw new HttpError(404, 'NOT_FOUND', 'OpenAI compatibility is disabled');
    }
    const body = await readJsonBody(request);

    if (body?.stream === true) {
      openSse(response);
      try {
        await streamOpenAiChatCompletion({
          appService: input.appService,
          store: input.store,
          request: body,
          principal: auth.principal,
          onChunk: async (payload) => {
            writeSseData(response, payload);
          },
        });
        writeSseDone(response);
      } catch (error) {
        writeSseData(response, {
          error: errorResponse(error).body.error,
        });
      }
      response.end();
      return;
    }

    const completion = await executeOpenAiChatCompletion({
      appService: input.appService,
      store: input.store,
      request: body,
      principal: auth.principal,
    });

    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(
      JSON.stringify(
        toOpenAiCompletionResponse({
          executionId: completion.executionId,
          responseText: completion.responseText,
          usage: completion.usage,
          model: completion.model,
          finishReason: completion.finishReason,
        })
      )
    );
    return;
  }

  throw new HttpError(404, 'NOT_FOUND', `Unknown route: ${method} ${pathname}`);
}

async function readJsonBody(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
}

function readInt(raw: string | null): number | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}
