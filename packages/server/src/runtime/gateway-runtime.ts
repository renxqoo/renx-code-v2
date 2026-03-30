import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { ChannelRegistry } from '@renx-code/core/channel';
import type { ServerConfig } from '../config';
import { SqliteGatewayStore, type GatewayStore } from '../storage';
import { ConversationRouter } from '../routing';
import { createBearerAuth } from '../gateway/auth';
import { PluginLoader } from '../plugin';
import type { ChannelAdapter, InboundChannelMessage, OutboundChannelMessage } from '@renx-code/core/channel';

export interface GatewayRuntimeOptions {
  readonly config: ServerConfig;
  readonly onAgentRequest?: (conversationId: string, text: string) => Promise<string>;
}

export class GatewayRuntime {
  private server: Server | null = null;
  private store!: GatewayStore;
  private channelRegistry!: ChannelRegistry;
  private router!: ConversationRouter;
  private pluginLoader!: PluginLoader;
  private authenticate!: (req: IncomingMessage) => { authenticated: boolean; principal?: { id: string; role: string }; error?: string };
  private channels: Map<string, ChannelAdapter> = new Map();

  constructor(private readonly options: GatewayRuntimeOptions) {}

  async start(): Promise<void> {
    const { config } = this.options;

    // 1. Initialize storage
    const dbPath = `${config.stateDir}/gateway.db`.replace('~', process.env.HOME || process.env.USERPROFILE || '~');
    this.store = new SqliteGatewayStore(dbPath);
    await this.store.prepare();

    // 2. Initialize components
    this.channelRegistry = new ChannelRegistry();
    this.router = new ConversationRouter(this.store);
    this.authenticate = createBearerAuth(config.authToken);
    this.pluginLoader = new PluginLoader();

    // 3. Load plugins (including wechat)
    const { channels } = await this.pluginLoader.loadAll(this.store);
    for (const adapter of channels) {
      this.channelRegistry.register(adapter);
      this.channels.set(adapter.id, adapter);
    }

    // 4. Start all channel adapters
    const channelContext = {
      onMessage: (message: InboundChannelMessage) => this.handleInboundMessage(message),
      logger: {
        info: (msg: string, meta?: Record<string, unknown>) => console.info(`[channel] ${msg}`, meta || ''),
        error: (msg: string, meta?: Record<string, unknown>) => console.error(`[channel] ${msg}`, meta || ''),
        warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[channel] ${msg}`, meta || ''),
      },
    };
    await this.channelRegistry.startAll(channelContext);

    // 5. Create HTTP server
    this.server = createServer((req, res) => this.handleRequest(req, res));

    // 6. Start listening
    return new Promise((resolve, reject) => {
      this.server!.listen(config.port, config.host, () => {
        console.info(`Gateway server listening on ${config.host}:${config.port}`);
        resolve();
      });
      this.server!.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    await this.channelRegistry.stopAll();
    this.store.close();
    if (this.server) {
      return new Promise((resolve, reject) => {
        this.server!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method || 'GET';

    // Health check (no auth required)
    if (path === '/health' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
      return;
    }

    // Channel webhook endpoints (no auth — verified by signature)
    if (path.match(/^\/api\/channels\/[\w-]+\/webhook$/) && method === 'POST') {
      await this.handleChannelWebhook(path, req, res);
      return;
    }

    // Auth-required endpoints
    const authResult = this.authenticate(req);
    if (!authResult.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: authResult.error } }));
      return;
    }

    // Route API endpoints
    if (path === '/api/sessions' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions: [] }));
      return;
    }

    if (path === '/api/runs' && method === 'POST') {
      await this.handleCreateRun(req, res);
      return;
    }

    if (path.match(/^\/api\/runs\/[\w-]+$/) && method === 'GET') {
      const executionId = path.split('/').pop();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ executionId, status: 'completed' }));
      return;
    }

    if (path === '/v1/chat/completions' && method === 'POST') {
      await this.handleChatCompletions(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: `Route ${method} ${path} not found` } }));
  }

  private async handleInboundMessage(message: InboundChannelMessage): Promise<void> {
    this.store.appendEvent('inbound_message', message.channelId, {
      peerId: message.peerId,
      text: message.text,
    });

    const { conversationId } = await this.router.routeInbound(message);

    if (message.text && this.options.onAgentRequest) {
      const response = await this.options.onAgentRequest(conversationId, message.text);
      if (response) {
        await this.sendToConversation(conversationId, response);
      }
    }
  }

  private async sendToConversation(conversationId: string, text: string): Promise<void> {
    const route = await this.router.resolveOutbound(conversationId);
    if (!route) return;

    const adapter = this.channels.get(route.channelId);
    if (!adapter) return;

    const outbound: OutboundChannelMessage = {
      conversationId,
      channelId: route.channelId,
      peerId: route.peerId,
      text,
    };
    await adapter.send(outbound);
  }

  private async handleChannelWebhook(path: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parts = path.split('/');
    const channelId = parts[3]; // /api/channels/:channelId/webhook

    const adapter = this.channels.get(channelId);
    if (!adapter) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: `Channel ${channelId} not found` } }));
      return;
    }

    // Handle GET for verification
    if (req.method === 'GET') {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const signature = url.searchParams.get('signature') || '';
      const timestamp = url.searchParams.get('timestamp') || '';
      const nonce = url.searchParams.get('nonce') || '';
      const echostr = url.searchParams.get('echostr') || undefined;

      if ('handleVerification' in adapter) {
        const result = (adapter as any).handleVerification({ signature, timestamp, nonce, echostr });
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(result);
      } else {
        res.writeHead(200);
        res.end('ok');
      }
      return;
    }

    // Handle POST for messages
    const body = await this.readBody(req);
    if ('handleWebhook' in adapter) {
      const result = await (adapter as any).handleWebhook(body, 'default');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(result);
    } else {
      res.writeHead(200);
      res.end('ok');
    }
  }

  private async handleCreateRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    let parsed: any;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } }));
      return;
    }

    const executionId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ executionId, status: 'running' }));
  }

  private async handleChatCompletions(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    let parsed: any;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } }));
      return;
    }

    const isStream = parsed.stream === true;
    const model = parsed.model || 'renx-code';
    const id = `chatcmpl-${Date.now()}`;

    // Extract the last user message
    const messages = parsed.messages || [];
    const lastUserMsg = messages.filter((m: any) => m.role === 'user').pop();
    const prompt = lastUserMsg?.content || '';

    if (isStream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      if (this.options.onAgentRequest) {
        try {
          const response = await this.options.onAgentRequest(`api:${id}`, prompt);
          // Stream the response in chunks
          const chunkSize = 20;
          for (let i = 0; i < response.length; i += chunkSize) {
            const chunk = response.slice(i, i + chunkSize);
            res.write(`data: ${JSON.stringify({
              id,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
            })}\n\n`);
          }
          res.write(`data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`);
          res.write('data: [DONE]\n\n');
        } catch (error) {
          res.write(`data: ${JSON.stringify({ error: { message: 'Internal error' } })}\n\n`);
        }
      } else {
        res.write(`data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: { content: 'No agent handler configured' }, finish_reason: null }],
        })}\n\n`);
        res.write('data: [DONE]\n\n');
      }
      res.end();
    } else {
      // Non-streaming response
      let content = 'No agent handler configured';
      if (this.options.onAgentRequest) {
        try {
          content = await this.options.onAgentRequest(`api:${id}`, prompt);
        } catch {
          content = 'Internal error';
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }));
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }
}
