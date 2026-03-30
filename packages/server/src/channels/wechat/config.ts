export interface WeChatConfig {
  readonly appId: string;
  readonly appSecret: string;
  readonly apiBase?: string;
  readonly webhookPath?: string;
  readonly verifyToken?: string;
  readonly encodingAesKey?: string;
}

export function resolveWeChatConfig(config: Record<string, unknown>): WeChatConfig {
  return {
    appId: config.appId as string || '',
    appSecret: config.appSecret as string || '',
    apiBase: config.apiBase as string || 'https://ilink.weixin.qq.com',
    webhookPath: config.webhookPath as string || '/channels/wechat/webhook',
    verifyToken: config.verifyToken as string,
    encodingAesKey: config.encodingAesKey as string,
  };
}
