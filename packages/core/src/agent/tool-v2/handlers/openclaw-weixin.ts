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
 *   status          - Check connection/account status
 *   list-accounts   - List registered WeChat accounts
 */

const WEIXIN_TOOL_DESCRIPTION = `Send messages and manage WeChat (Weixin) connections via iLink Bot API.

Actions:
- send: Send a text message to a WeChat user (requires peerId + text)
- login-qr-start: Generate a QR code for WeChat login
- login-qr-wait: Wait for QR scan confirmation (requires sessionKey from login-qr-start)
- status: Check current connection status
- list-accounts: List all registered WeChat accounts

This tool connects directly to the iLink Bot API without requiring openclaw.`;

const schema = z
  .object({
    action: z
      .enum(['send', 'status', 'login-qr-start', 'login-qr-wait', 'list-accounts'])
      .describe('Action to perform'),
    peerId: z.string().optional().describe('WeChat user ID (for send action)'),
    text: z.string().optional().describe('Message text (for send action)'),
    sessionKey: z.string().optional().describe('Session key from login-qr-start'),
    accountId: z.string().optional().describe('Account ID (optional)'),
  })
  .strict();

export interface WeixinToolOptions {
  stateDir?: string;
}

export class OpenClawWeixinTool extends StructuredToolHandler<typeof schema> {
  private readonly stateDir?: string;

  constructor(options: WeixinToolOptions = {}) {
    super({
      name: 'openclaw_weixin',
      description: WEIXIN_TOOL_DESCRIPTION,
      schema,
      supportsParallel: false,
      mutating: true,
      tags: ['channel', 'wechat', 'weixin'],
    });
    this.stateDir = options.stateDir;
  }

  plan(args: z.infer<typeof schema>, _context: ToolExecutionContext): ToolExecutionPlan {
    return {
      mutating: args.action === 'send',
      networkTargets:
        args.action === 'send' || args.action === 'status'
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

    const account = adapter.getFirstConfiguredAccount();
    if (!account) {
      throw new ToolV2ExecutionError(
        'No configured WeChat account. Use login-qr-start first to login.'
      );
    }

    const contextToken = adapter.getContextToken(account.accountId, args.peerId);

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
      };
    });

    return {
      output: JSON.stringify(
        {
          status: accounts.length > 0 ? 'configured' : 'not_configured',
          accounts,
          totalAccounts: accounts.length,
          configuredAccounts: accounts.filter((a: any) => a.configured).length,
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

  private async handleListAccounts(adapter: any): Promise<ToolHandlerResult> {
    const accountIds = adapter.listAccountIds();
    const accounts = accountIds.map((id: string) => {
      const acc = adapter.resolveAccount(id);
      return {
        accountId: acc.accountId,
        configured: acc.configured,
        enabled: acc.enabled,
      };
    });

    return {
      output: JSON.stringify({ accounts }, null, 2),
    };
  }
}
