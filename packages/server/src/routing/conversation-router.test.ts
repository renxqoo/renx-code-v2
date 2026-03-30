import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { ConversationRouter } from './conversation-router';
import { SqliteGatewayStore } from '../storage/sqlite-store';
import type { InboundChannelMessage } from '@renx-code/core/channel';

describe('ConversationRouter', () => {
  let store: SqliteGatewayStore;
  let router: ConversationRouter;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `test-router-${Date.now()}.db`);
    store = new SqliteGatewayStore(dbPath);
    await store.prepare();
    router = new ConversationRouter(store);
  });

  afterEach(() => {
    store.close();
    try { fs.unlinkSync(dbPath); } catch {}
  });

  function createDmMessage(overrides?: Partial<InboundChannelMessage>): InboundChannelMessage {
    return {
      channelId: 'wechat',
      accountId: 'acc1',
      peerId: 'user1',
      senderId: 'user1',
      text: 'Hello',
      receivedAt: Date.now(),
      ...overrides,
    };
  }

  describe('routeInbound', () => {
    it('should create a DM conversation ID', async () => {
      const msg = createDmMessage();
      const result = await router.routeInbound(msg);
      expect(result.conversationId).toBe('dm:wechat:acc1:user1');
      expect(result.message).toBe(msg);
    });

    it('should create a group conversation ID with threadId', async () => {
      const msg = createDmMessage({ threadId: 'thread1', senderId: 'user2' });
      const result = await router.routeInbound(msg);
      expect(result.conversationId).toBe('group:wechat:acc1:thread1');
    });

    it('should persist conversation to store', async () => {
      const msg = createDmMessage();
      await router.routeInbound(msg);
      const record = store.getConversation('dm:wechat:acc1:user1');
      expect(record).toBeDefined();
      expect(record!.channel_id).toBe('wechat');
      expect(record!.peer_id).toBe('user1');
    });

    it('should reuse existing conversation on repeated messages', async () => {
      const msg1 = createDmMessage();
      const msg2 = createDmMessage({ text: 'Second message' });
      const r1 = await router.routeInbound(msg1);
      const r2 = await router.routeInbound(msg2);
      expect(r1.conversationId).toBe(r2.conversationId);
    });
  });

  describe('resolveOutbound', () => {
    it('should resolve outbound route for existing conversation', async () => {
      const msg = createDmMessage();
      await router.routeInbound(msg);
      const route = await router.resolveOutbound('dm:wechat:acc1:user1');
      expect(route).toBeDefined();
      expect(route!.channelId).toBe('wechat');
      expect(route!.peerId).toBe('user1');
      expect(route!.threadId).toBeUndefined();
    });

    it('should return undefined for non-existent conversation', async () => {
      const route = await router.resolveOutbound('dm:unknown:unknown:unknown');
      expect(route).toBeUndefined();
    });

    it('should include threadId in outbound route for group conversations', async () => {
      const msg = createDmMessage({ threadId: 'thread1' });
      await router.routeInbound(msg);
      const route = await router.resolveOutbound('group:wechat:acc1:thread1');
      expect(route).toBeDefined();
      expect(route!.threadId).toBe('thread1');
    });
  });
});
