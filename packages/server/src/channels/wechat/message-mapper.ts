import type { InboundChannelMessage, OutboundChannelMessage } from '@renx-code/core/channel';

export function mapWechatToInbound(
  parsed: { fromUser: string; toUser: string; content: string; msgType: string; createTime: number },
  accountId: string
): InboundChannelMessage {
  return {
    channelId: 'wechat',
    accountId,
    peerId: parsed.fromUser,
    senderId: parsed.fromUser,
    text: parsed.msgType === 'text' ? parsed.content : undefined,
    media: parsed.msgType === 'image' ? { type: 'image' } : undefined,
    rawEvent: parsed,
    receivedAt: parsed.createTime * 1000 || Date.now(),
  };
}

export function mapOutboundToWechat(message: OutboundChannelMessage): { userId: string; text: string } {
  return {
    userId: message.peerId,
    text: message.text,
  };
}
