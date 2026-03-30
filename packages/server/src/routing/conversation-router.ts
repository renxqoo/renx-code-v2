import type { InboundChannelMessage, RoutedMessage, OutboundRoute } from '@renx-code/core/channel';
import type { GatewayStore } from '../storage';

export class ConversationRouter {
  constructor(private readonly store: GatewayStore) {}

  async routeInbound(message: InboundChannelMessage): Promise<RoutedMessage> {
    const conversationId = this.buildConversationId(message);
    this.store.upsertConversation({
      id: conversationId,
      channel_id: message.channelId,
      account_id: message.accountId,
      peer_id: message.peerId,
      thread_id: message.threadId ?? null,
    });
    return { conversationId, message };
  }

  async resolveOutbound(conversationId: string): Promise<OutboundRoute | undefined> {
    const record = this.store.getConversation(conversationId);
    if (!record) return undefined;
    return {
      channelId: record.channel_id,
      accountId: record.account_id,
      peerId: record.peer_id,
      threadId: record.thread_id ?? undefined,
    };
  }

  private buildConversationId(message: InboundChannelMessage): string {
    if (message.threadId) {
      return `group:${message.channelId}:${message.accountId}:${message.threadId}`;
    }
    return `dm:${message.channelId}:${message.accountId}:${message.peerId}`;
  }
}
