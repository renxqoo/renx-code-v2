import type { WeChatConfig } from './config';

export interface ILinkBotClientDeps {
  readonly config: WeChatConfig;
  readonly logger: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

interface AccessTokenResponse {
  access_token: string;
  expires_in: number;
}

interface SendMessageResponse {
  errcode: number;
  errmsg: string;
  msgid?: string;
}

export class ILinkBotClient {
  private accessToken: string = '';
  private tokenExpiresAt: number = 0;
  private readonly config: WeChatConfig;
  private readonly logger: ILinkBotClientDeps['logger'];

  constructor(private readonly deps: ILinkBotClientDeps) {
    this.config = deps.config;
    this.logger = deps.logger;
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }
    const url = `${this.config.apiBase}/cgi-bin/token?grant_type=client_credential&appid=${this.config.appId}&secret=${this.config.appSecret}`;
    try {
      const response = await fetch(url);
      const data = await response.json() as AccessTokenResponse;
      if (!data.access_token) {
        throw new Error(`Failed to get access token: ${JSON.stringify(data)}`);
      }
      this.accessToken = data.access_token;
      this.tokenExpiresAt = Date.now() + (data.expires_in - 300) * 1000;
      return this.accessToken;
    } catch (error) {
      this.logger.error('Failed to get WeChat access token', error);
      throw error;
    }
  }

  async sendTextMessage(userId: string, text: string): Promise<SendMessageResponse> {
    const token = await this.getAccessToken();
    const url = `${this.config.apiBase}/cgi-bin/message/custom/send?access_token=${token}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: userId,
        msgtype: 'text',
        text: { content: text },
      }),
    });
    return response.json() as Promise<SendMessageResponse>;
  }

  async sendImageMessage(userId: string, mediaId: string): Promise<SendMessageResponse> {
    const token = await this.getAccessToken();
    const url = `${this.config.apiBase}/cgi-bin/message/custom/send?access_token=${token}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: userId,
        msgtype: 'image',
        image: { media_id: mediaId },
      }),
    });
    return response.json() as Promise<SendMessageResponse>;
  }

  verifySignature(signature: string, timestamp: string, nonce: string): boolean {
    // iLink signature verification
    // In production, implement proper cryptographic verification
    return signature.length > 0 && timestamp.length > 0;
  }

  parseInboundMessage(xmlBody: string): { fromUser: string; toUser: string; content: string; msgType: string; createTime: number } | null {
    // Parse iLink XML message format
    // Extract FromUserName, ToUserName, Content, MsgType, CreateTime
    const fromUserMatch = xmlBody.match(/<FromUserName><!\[CDATA\[(.*?)\]\]><\/FromUserName>/);
    const toUserMatch = xmlBody.match(/<ToUserName><!\[CDATA\[(.*?)\]\]><\/ToUserName>/);
    const contentMatch = xmlBody.match(/<Content><!\[CDATA\[(.*?)\]\]><\/Content>/);
    const msgTypeMatch = xmlBody.match(/<MsgType><!\[CDATA\[(.*?)\]\]><\/MsgType>/);
    const createTimeMatch = xmlBody.match(/<CreateTime>(\d+)<\/CreateTime>/);

    if (!fromUserMatch || !toUserMatch || !msgTypeMatch) return null;

    return {
      fromUser: fromUserMatch[1],
      toUser: toUserMatch[1],
      content: contentMatch?.[1] || '',
      msgType: msgTypeMatch[1],
      createTime: createTimeMatch ? parseInt(createTimeMatch[1], 10) : Date.now(),
    };
  }
}
