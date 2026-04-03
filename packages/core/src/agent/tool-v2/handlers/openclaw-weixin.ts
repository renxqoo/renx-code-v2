import { z } from 'zod';
import type { ToolExecutionContext } from '../context';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import { ToolV2ExecutionError } from '../errors';
import { StructuredToolHandler } from '../registry';

/**
 * Tool for interacting with WeChat (Weixin) directly via iLink Bot API.
 * No openclaw dependency - uses @renx-code/weixin-adapter internally.
 *
 * Actions:
 *   send            - Send a text message to a WeChat user
 *   login-qr-start  - Start QR code login, returns QR URL
 *   login-qr-wait   - Wait for QR scan confirmation
 *   listen          - Start long-polling for inbound messages (keeps connection alive)
 *   stop-listen     - Stop the inbound message listener
 *   status          - Check connection/account status
 *   list-accounts   - List registered WeChat accounts
 */

const WEIXIN_TOOL_DESCRIPTION = `Send messages and manage WeChat (Weixin) connections via iLink Bot API.

Actions:
- send: Send a text message to a WeChat user (requires peerId + text)
- login-qr-start: Generate a QR code for WeChat login
- login-qr-wait: Wait for QR scan confirmation (requires sessionKey from login-qr-start)
- listen: Start listening for inbound WeChat messages (long-poll). After login-qr-wait succeeds, call this to receive messages. Runs in background until stop-listen is called.
- stop-listen: Stop listening for inbound messages
- status: Check current connection status
- list-accounts: List all registered WeChat accounts

Important: After login-qr-wait succeeds, you MUST call "listen" to start receiving inbound messages. Without it, incoming WeChat messages will be missed.

This tool connects directly to the iLink Bot API without requiring openclaw.`;

const schema = z
  .object({
    action: z
      .enum(['send', 'status', 'login-qr-start', 'login-qr-wait', 'listen', 'stop-listen', 'list-accounts'])
      .describe('Action to perform'),
    peerId: z.string().optional().describe('WeChat user ID (for send action)'),
    text: z.string().optional().describe('Message text (for send action)'),
    sessionKey: z.string().optional().describe('Session key from login-qr-start'),
    accountId: z.string().optional().describe('Account ID (optional, defaults to first configured)'),
  })
  .strict();

/**
 * Callback invoked when an inbound WeChat message is received while listening.
 */
export type WeixinInboundMessageCallback = (event: {
  body: string;
  fromUserId: string;
  accountId: string;
  contextToken?: string;
  timestamp?: number;
}) => void | Promise<void>;

export interface WeixinToolOptions {
  onInboundMessage?: WeixinInboundMessageCallback;
}

/**
 * Tracks a running monitor for a specific account.
 */
interface ActiveMonitor {
  accountId: string;
  abortController: AbortController;
  promise: Promise<void>;
}

export class OpenClawWeixinTool extends StructuredToolHandler<typeof schema> {
  private readonly onInboundMessage?: WeixinInboundMessageCallback;
  private readonly activeMonitors = new Map<string, ActiveMonitor>();

  constructor(options: WeixinToolOptions = {}) {
    super({
      name: 'openclaw_weixin',
      description: WEIXIN_TOOL_DESCRIPTION,
      schema,
      supportsParallel: false,
      mutating: true,
      tags: ['channel', 'wechat', 'weixin'],
    });
    this.onInboundMessage = options.onInboundMessage;
  }

  plan(args: z.infer<typeof schema>, _context: ToolExecutionContext): ToolExecutionPlan {
    return {
      mutating: args.action === 'send',
      networkTargets:
        args.action === 'send' || args.action === 'status' || args.action === 'listen'
          ? ['https://ilinkai.weixin.qq.com']
          : [],
      riskLevel: args.action === 'send' ? 'medium' : 'low',
    };
  }

  async execute(
    args: z.infer<typeof schema>,
    _context: ToolExecutionContext
  ): Promise<ToolHandlerResult> {
    const adapter = await import('@renx-code/weixin-adapter');

    switch (args.action) {
      case 'send':
        return this.handleSend(args, adapter);
      case 'status':
        return this.handleStatus(adapter);
      case 'login-qr-start':
        return this.handleLoginQrStart(adapter);
      case 'login-qr-wait':
        return this.handleLoginQrWait(args, adapter);
      case 'listen':
        return this.handleListen(args, adapter);
      case 'stop-listen':
        return this.handleStopListen(args);
      case 'list-accounts':
        return this.handleListAccounts(adapter);
      default:
        throw new ToolV2ExecutionError(`Unknown action: ${args.action}`);
    }
  }

  private async handleSend(
    args: z.infer<typeof schema>,
    adapter: any
  ): Promise<ToolHandlerResult> {
    if (!args.peerId || !args.text) {
      throw new ToolV2ExecutionError('peerId and text are required for send action');
    }

    // Resolve account: prefer explicit accountId, fall back to first configured
    let account: any;
    if (args.accountId) {
      account = adapter.resolveAccount(args.accountId);
      if (!account || !account.configured) {
        throw new ToolV2ExecutionError(
          `Account ${args.accountId} is not configured. Use login-qr-start first.`
        );
      }
    } else {
      account = adapter.getFirstConfiguredAccount();
      if (!account) {
        throw new ToolV2ExecutionError(
          'No configured WeChat account. Use login-qr-start first to login.'
        );
      }
    }

    // Try to get cached contextToken (only available after receiving a message from this peer via listen)
    let contextToken = adapter.getContextToken(account.accountId, args.peerId);

    if (!contextToken) {
      // No contextToken — we haven't received a message from this peer yet.
      // Try calling getConfig to establish a session context.
      // Note: getConfig's primary purpose is typing_ticket, but iLink server may
      // also establish a context for this peer in the process.
      try {
        const configResp = await adapter.getConfig({
          baseUrl: account.baseUrl,
          token: account.token,
          ilinkUserId: args.peerId,
        });
        // getConfig currently returns { ret, errmsg, typing_ticket } — no context_token.
        // If a future API version adds context_token, save it.
        if ((configResp as any).context_token) {
          contextToken = (configResp as any).context_token;
          adapter.setContextToken(account.accountId, args.peerId, contextToken);
        }
      } catch (err) {
        // getConfig failed — continue, send without context
      }
    }

    const result = await adapter.sendMessageWeixin({
      to: args.peerId,
      text: args.text,
      opts: {
        baseUrl: account.baseUrl,
        token: account.token,
        contextToken,
      },
    });

    return {
      output: JSON.stringify({
        success: true,
        messageId: result.messageId,
        to: args.peerId,
        account: account.accountId,
      }),
    };
  }

  private async handleStatus(adapter: any): Promise<ToolHandlerResult> {
    const accountIds = adapter.listAccountIds();
    const accounts = accountIds.map((id: string) => {
      const acc = adapter.resolveAccount(id);
      return {
        accountId: acc.accountId,
        configured: acc.configured,
        enabled: acc.enabled,
        hasToken: Boolean(acc.token),
        listening: this.activeMonitors.has(id),
      };
    });

    return {
      output: JSON.stringify(
        {
          status: accounts.length > 0 ? 'configured' : 'not_configured',
          accounts,
          totalAccounts: accounts.length,
          configuredAccounts: accounts.filter((a: any) => a.configured).length,
          listeningAccounts: Array.from(this.activeMonitors.keys()),
        },
        null,
        2
      ),
    };
  }

  private async handleLoginQrStart(adapter: any): Promise<ToolHandlerResult> {
    const result = await adapter.startWeixinLoginWithQr({});

    return {
      output: JSON.stringify(
        {
          qrcodeUrl: result.qrcodeUrl,
          sessionKey: result.sessionKey,
          message: result.message,
          instruction: result.qrcodeUrl
            ? 'Open the QR URL in a browser and scan with WeChat. Then call login-qr-wait with the sessionKey.'
            : result.message,
        },
        null,
        2
      ),
    };
  }

  private async handleLoginQrWait(
    args: z.infer<typeof schema>,
    adapter: any
  ): Promise<ToolHandlerResult> {
    if (!args.sessionKey) {
      throw new ToolV2ExecutionError('sessionKey is required for login-qr-wait action');
    }

    const result = await adapter.waitForWeixinLogin({
      sessionKey: args.sessionKey,
      timeoutMs: 120_000,
    });

    if (result.connected && result.botToken && result.accountId) {
      const normalizedId = adapter.normalizeAccountId(result.accountId);
      adapter.saveAccount(normalizedId, {
        token: result.botToken,
        baseUrl: result.baseUrl,
        userId: result.userId,
      });
      adapter.registerAccountId(normalizedId);

      return {
        output: JSON.stringify(
          {
            connected: true,
            accountId: normalizedId,
            message: result.message,
            nextStep: 'Call the "listen" action to start receiving inbound WeChat messages. Without it, incoming messages will not be received.',
          },
          null,
          2
        ),
      };
    }

    return {
      output: JSON.stringify(
        {
          connected: false,
          message: result.message,
        },
        null,
        2
      ),
    };
  }

  /**
   * Start long-polling for inbound messages via startWeixinMonitor.
   * The monitor runs in the background until stop-listen is called.
   */
  private async handleListen(
    args: z.infer<typeof schema>,
    adapter: any
  ): Promise<ToolHandlerResult> {
    const accountId = args.accountId || this.resolveFirstAccountId(adapter);
    if (!accountId) {
      throw new ToolV2ExecutionError(
        'No WeChat account available. Use login-qr-start and login-qr-wait first to connect.'
      );
    }

    // Already listening for this account
    if (this.activeMonitors.has(accountId)) {
      return {
        output: JSON.stringify({
          listening: true,
          accountId,
          message: `Already listening for messages on account ${accountId}.`,
        }),
      };
    }

    const account = adapter.resolveAccount(accountId);
    if (!account || !account.token) {
      throw new ToolV2ExecutionError(
        `Account ${accountId} is not configured. Use login-qr-start and login-qr-wait first.`
      );
    }

    const abortController = new AbortController();
    const { signal } = abortController;

    const monitorPromise = adapter
      .startWeixinMonitor({
        baseUrl: account.baseUrl,
        token: account.token,
        accountId,
        abortSignal: signal,
        onMessage: async (event: any) => {
          if (this.onInboundMessage) {
            await this.onInboundMessage({
              body: event.body,
              fromUserId: event.fromUserId,
              accountId: event.accountId,
              contextToken: event.contextToken,
              timestamp: event.timestamp,
            });
          }
        },
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        // Monitor ended with error — clean up
        this.activeMonitors.delete(accountId);
        // Re-throw so the promise rejection is observable if needed
        throw new Error(`WeChat monitor for ${accountId} ended: ${message}`);
      });

    const monitor: ActiveMonitor = {
      accountId,
      abortController,
      promise: monitorPromise,
    };
    this.activeMonitors.set(accountId, monitor);

    return {
      output: JSON.stringify({
        listening: true,
        accountId,
        message: `Started listening for inbound WeChat messages on account ${accountId}. Messages will be forwarded via the onInboundMessage callback. Use "stop-listen" to stop.`,
      }),
    };
  }

  /**
   * Stop the inbound message listener for a given account (or all accounts).
   */
  private async handleStopListen(args: z.infer<typeof schema>): Promise<ToolHandlerResult> {
    if (args.accountId) {
      const monitor = this.activeMonitors.get(args.accountId);
      if (!monitor) {
        return {
          output: JSON.stringify({
            stopped: false,
            message: `No active listener for account ${args.accountId}.`,
          }),
        };
      }
      monitor.abortController.abort();
      this.activeMonitors.delete(args.accountId);
      return {
        output: JSON.stringify({
          stopped: true,
          accountId: args.accountId,
          message: `Stopped listening for messages on account ${args.accountId}.`,
        }),
      };
    }

    // Stop all monitors
    const stoppedAccounts: string[] = [];
    for (const [id, monitor] of this.activeMonitors) {
      monitor.abortController.abort();
      stoppedAccounts.push(id);
    }
    this.activeMonitors.clear();

    return {
      output: JSON.stringify({
        stopped: true,
        accounts: stoppedAccounts,
        message: `Stopped ${stoppedAccounts.length} listener(s).`,
      }),
    };
  }

  private async handleListAccounts(adapter: any): Promise<ToolHandlerResult> {
    const accountIds = adapter.listAccountIds();
    const accounts = accountIds.map((id: string) => {
      const acc = adapter.resolveAccount(id);
      return {
        accountId: acc.accountId,
        configured: acc.configured,
        enabled: acc.enabled,
        listening: this.activeMonitors.has(id),
      };
    });

    return {
      output: JSON.stringify({ accounts }, null, 2),
    };
  }

  private resolveFirstAccountId(adapter: any): string | undefined {
    const account = adapter.getFirstConfiguredAccount();
    return account?.accountId;
  }
}
