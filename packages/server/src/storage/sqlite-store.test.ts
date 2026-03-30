import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { SqliteGatewayStore } from './sqlite-store';

describe('SqliteGatewayStore', () => {
  let store: SqliteGatewayStore;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `test-gateway-${Date.now()}.db`);
    store = new SqliteGatewayStore(dbPath);
    await store.prepare();
  });

  afterEach(() => {
    store.close();
    try { fs.unlinkSync(dbPath); } catch {}
  });

  describe('conversations', () => {
    it('should insert and retrieve a conversation', () => {
      const record = store.upsertConversation({
        id: 'dm:wechat:acc1:user1',
        channel_id: 'wechat',
        account_id: 'acc1',
        peer_id: 'user1',
        thread_id: null,
      });
      expect(record.id).toBe('dm:wechat:acc1:user1');
      expect(record.created_at).toBeGreaterThan(0);

      const retrieved = store.getConversation('dm:wechat:acc1:user1');
      expect(retrieved).toBeDefined();
      expect(retrieved!.channel_id).toBe('wechat');
      expect(retrieved!.peer_id).toBe('user1');
    });

    it('should update existing conversation on upsert', () => {
      store.upsertConversation({
        id: 'dm:wechat:acc1:user1',
        channel_id: 'wechat',
        account_id: 'acc1',
        peer_id: 'user1',
        thread_id: null,
      });
      const updated = store.upsertConversation({
        id: 'dm:wechat:acc1:user1',
        channel_id: 'wechat',
        account_id: 'acc1',
        peer_id: 'user1',
        thread_id: null,
      });
      expect(updated.updated_at).toBeGreaterThanOrEqual(updated.created_at);
    });

    it('should find conversation by channel + account + peer', () => {
      store.upsertConversation({
        id: 'dm:wechat:acc1:user1',
        channel_id: 'wechat',
        account_id: 'acc1',
        peer_id: 'user1',
        thread_id: null,
      });
      const found = store.findConversation('wechat', 'acc1', 'user1');
      expect(found).toBeDefined();
      expect(found!.id).toBe('dm:wechat:acc1:user1');
    });

    it('should find conversation with thread_id', () => {
      store.upsertConversation({
        id: 'group:wechat:acc1:thread1',
        channel_id: 'wechat',
        account_id: 'acc1',
        peer_id: 'user1',
        thread_id: 'thread1',
      });
      const found = store.findConversation('wechat', 'acc1', 'user1', 'thread1');
      expect(found).toBeDefined();
      expect(found!.id).toBe('group:wechat:acc1:thread1');
    });

    it('should return undefined for non-existent conversation', () => {
      expect(store.getConversation('nonexistent')).toBeUndefined();
      expect(store.findConversation('x', 'y', 'z')).toBeUndefined();
    });
  });

  describe('sender allowlist', () => {
    it('should add and check sender allowlist', () => {
      expect(store.isSenderAllowed('wechat', 'user1')).toBe(false);
      store.addSenderToAllowlist('wechat', 'user1');
      expect(store.isSenderAllowed('wechat', 'user1')).toBe(true);
    });

    it('should remove sender from allowlist', () => {
      store.addSenderToAllowlist('wechat', 'user1');
      expect(store.isSenderAllowed('wechat', 'user1')).toBe(true);
      store.removeSenderFromAllowlist('wechat', 'user1');
      expect(store.isSenderAllowed('wechat', 'user1')).toBe(false);
    });

    it('should handle duplicate allowlist entries', () => {
      store.addSenderToAllowlist('wechat', 'user1');
      store.addSenderToAllowlist('wechat', 'user1');
      expect(store.isSenderAllowed('wechat', 'user1')).toBe(true);
      store.removeSenderFromAllowlist('wechat', 'user1');
      expect(store.isSenderAllowed('wechat', 'user1')).toBe(false);
    });

    it('should isolate allowlists by channel', () => {
      store.addSenderToAllowlist('wechat', 'user1');
      expect(store.isSenderAllowed('wechat', 'user1')).toBe(true);
      expect(store.isSenderAllowed('telegram', 'user1')).toBe(false);
    });
  });

  describe('events', () => {
    it('should append and store events', () => {
      store.appendEvent('inbound_message', 'wechat', { peerId: 'user1', text: 'hello' });
      store.appendEvent('system', null, { action: 'started' });
      // No direct read method, just verify no errors
    });
  });

  describe('channel accounts', () => {
    it('should insert and retrieve channel account', () => {
      store.upsertChannelAccount('acc1', 'wechat', { appId: 'wx123', appSecret: 'secret' });
      const account = store.getChannelAccount('acc1');
      expect(account).toBeDefined();
      expect(account!.channel_id).toBe('wechat');
      expect(JSON.parse(account!.config)).toEqual({ appId: 'wx123', appSecret: 'secret' });
    });

    it('should update existing channel account', () => {
      store.upsertChannelAccount('acc1', 'wechat', { appId: 'wx123' });
      store.upsertChannelAccount('acc1', 'wechat', { appId: 'wx456' }, 'inactive');
      const account = store.getChannelAccount('acc1');
      expect(account!.status).toBe('inactive');
      expect(JSON.parse(account!.config).appId).toBe('wx456');
    });
  });
});
