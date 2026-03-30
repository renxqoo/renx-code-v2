import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  thread_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_accounts (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_pairings (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  paired_by TEXT,
  paired_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE TABLE IF NOT EXISTS sender_allowlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  allowed_at INTEGER NOT NULL,
  UNIQUE(channel_id, peer_id)
);

CREATE TABLE IF NOT EXISTS gateway_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  channel_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_channel_peer
  ON conversations(channel_id, account_id, peer_id);
CREATE INDEX IF NOT EXISTS idx_gateway_events_type
  ON gateway_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_sender_allowlist_channel
  ON sender_allowlist(channel_id, peer_id);
`;

export interface ConversationRecord {
  readonly id: string;
  readonly channel_id: string;
  readonly account_id: string;
  readonly peer_id: string;
  readonly thread_id: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface GatewayStore {
  prepare(): Promise<void>;
  close(): void;

  // Conversations
  getConversation(id: string): ConversationRecord | undefined;
  findConversation(channelId: string, accountId: string, peerId: string, threadId?: string): ConversationRecord | undefined;
  upsertConversation(record: Omit<ConversationRecord, 'created_at' | 'updated_at'>): ConversationRecord;

  // Sender allowlist
  isSenderAllowed(channelId: string, peerId: string): boolean;
  addSenderToAllowlist(channelId: string, peerId: string): void;
  removeSenderFromAllowlist(channelId: string, peerId: string): void;

  // Events
  appendEvent(eventType: string, channelId: string | null, payload: Record<string, unknown>): void;

  // Channel accounts
  getChannelAccount(id: string): { id: string; channel_id: string; config: string; status: string } | undefined;
  upsertChannelAccount(id: string, channelId: string, config: Record<string, unknown>, status?: string): void;
}

export class SqliteGatewayStore implements GatewayStore {
  private db!: Database.Database;

  constructor(private readonly dbPath: string) {}

  async prepare(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db?.close();
  }

  getConversation(id: string): ConversationRecord | undefined {
    return this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRecord | undefined;
  }

  findConversation(channelId: string, accountId: string, peerId: string, threadId?: string): ConversationRecord | undefined {
    if (threadId) {
      return this.db
        .prepare('SELECT * FROM conversations WHERE channel_id = ? AND account_id = ? AND peer_id = ? AND thread_id = ?')
        .get(channelId, accountId, peerId, threadId) as ConversationRecord | undefined;
    }
    return this.db
      .prepare('SELECT * FROM conversations WHERE channel_id = ? AND account_id = ? AND peer_id = ? AND thread_id IS NULL')
      .get(channelId, accountId, peerId) as ConversationRecord | undefined;
  }

  upsertConversation(record: Omit<ConversationRecord, 'created_at' | 'updated_at'>): ConversationRecord {
    const now = Date.now();
    const existing = this.getConversation(record.id);
    if (existing) {
      this.db
        .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
        .run(now, record.id);
      return { ...existing, updated_at: now };
    }
    const row: ConversationRecord = { ...record, created_at: now, updated_at: now };
    this.db
      .prepare('INSERT INTO conversations (id, channel_id, account_id, peer_id, thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.channel_id, row.account_id, row.peer_id, row.thread_id, row.created_at, row.updated_at);
    return row;
  }

  isSenderAllowed(channelId: string, peerId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM sender_allowlist WHERE channel_id = ? AND peer_id = ?')
      .get(channelId, peerId);
    return !!row;
  }

  addSenderToAllowlist(channelId: string, peerId: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO sender_allowlist (channel_id, peer_id, allowed_at) VALUES (?, ?, ?)')
      .run(channelId, peerId, Date.now());
  }

  removeSenderFromAllowlist(channelId: string, peerId: string): void {
    this.db
      .prepare('DELETE FROM sender_allowlist WHERE channel_id = ? AND peer_id = ?')
      .run(channelId, peerId);
  }

  appendEvent(eventType: string, channelId: string | null, payload: Record<string, unknown>): void {
    this.db
      .prepare('INSERT INTO gateway_events (event_type, channel_id, payload, created_at) VALUES (?, ?, ?, ?)')
      .run(eventType, channelId, JSON.stringify(payload), Date.now());
  }

  getChannelAccount(id: string): { id: string; channel_id: string; config: string; status: string } | undefined {
    return this.db.prepare('SELECT * FROM channel_accounts WHERE id = ?').get(id) as any;
  }

  upsertChannelAccount(id: string, channelId: string, config: Record<string, unknown>, status = 'active'): void {
    const now = Date.now();
    const configJson = JSON.stringify(config);
    const existing = this.db.prepare('SELECT 1 FROM channel_accounts WHERE id = ?').get(id);
    if (existing) {
      this.db.prepare('UPDATE channel_accounts SET config = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(configJson, status, now, id);
    } else {
      this.db.prepare('INSERT INTO channel_accounts (id, channel_id, config, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, channelId, configJson, status, now, now);
    }
  }
}
