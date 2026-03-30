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
