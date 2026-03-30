import type {
  ChannelAdapter,
  ChannelAdapterContext,
  OutboundChannelMessage,
  SendResult,
  ChannelProbeResult,
  InboundChannelMessage,
} from '@renx-code/core/channel';
import { ILinkBotClient } from './ilink-client';
import { resolveWeChatConfig, type WeChatConfig } from './config';
import { mapWechatToInbound, mapOutboundToWechat } from './message-mapper';

export class WeChatChannelAdapter implements ChannelAdapter {
  readonly id = 'wechat';
  private context!: ChannelAdapterContext;
  private client!: ILinkBotClient;
  private config!: WeChatConfig;
  private running = false;

  constructor(config: Record<string, unknown>) {
    this.config = resolveWeChatConfig(config);
    this.client = new ILinkBotClient({
      config: this.config,
      logger: {
        info: (...args: unknown[]) => console.info('[wechat]', ...args),
        error: (...args: unknown[]) => console.error('[wechat]', ...args),
      },
    });
  }

  async start(context: ChannelAdapterContext): Promise<void> {
    this.context = context;
    this.running = true;
    this.context.logger.info('WeChat channel adapter started', { appId: this.config.appId });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.context.logger.info('WeChat channel adapter stopped');
  }

  async send(message: OutboundChannelMessage): Promise<SendResult> {
    try {
      const { userId, text } = mapOutboundToWechat(message);
      const result = await this.client.sendTextMessage(userId, text);
      if (result.errcode === 0) {
        return { success: true, messageId: result.msgid };
      }
      return { success: false, error: `${result.errcode}: ${result.errmsg}` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  }

  async probe(): Promise<ChannelProbeResult> {
    try {
      await this.client.getAccessToken();
      return { connected: true, details: { appId: this.config.appId } };
    } catch {
      return { connected: false, details: { appId: this.config.appId } };
    }
  }

  async handleWebhook(body: string, accountId: string): Promise<string> {
    const parsed = this.client.parseInboundMessage(body);
    if (!parsed) return 'success';

    const inboundMessage = mapWechatToInbound(parsed, accountId);

    // Process message asynchronously — don't block the webhook response
    this.context.onMessage(inboundMessage).catch((error) => {
      this.context.logger.error('Failed to process WeChat inbound message', { error });
    });

    return 'success';
  }

  handleVerification(params: { signature: string; timestamp: string; nonce: string; echostr?: string }): string {
    const valid = this.client.verifySignature(params.signature, params.timestamp, params.nonce);
    if (valid && params.echostr) {
      return params.echostr;
    }
    return '';
  }
}
