/**
 * Channel types — unified message formats for multi-channel communication.
 *
 * Channels (WeChat, WebChat, Telegram, etc.) convert their native events
 * to/from these types. The agent kernel never sees a specific channel format.
 */

// ── Inbound Message ──────────────────────────────────────────────────

export interface InboundChannelMessage {
  readonly channelId: string;
  readonly accountId: string;
  readonly peerId: string;
  readonly threadId?: string;
  readonly senderId: string;
  readonly text?: string;
  readonly media?: ChannelMedia;
  readonly rawEvent?: unknown;
  readonly receivedAt: number;
}

// ── Outbound Message ─────────────────────────────────────────────────

export interface OutboundChannelMessage {
  readonly conversationId: string;
  readonly channelId: string;
  readonly peerId: string;
  readonly text: string;
  readonly replyToMessageId?: string;
}

// ── Media ────────────────────────────────────────────────────────────

export interface ChannelMedia {
  readonly type: 'image' | 'audio' | 'video' | 'file';
  readonly url?: string;
  readonly base64?: string;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
}

// ── Adapter Interfaces ───────────────────────────────────────────────

export interface ChannelAdapter {
  readonly id: string;
  start(context: ChannelAdapterContext): Promise<void>;
  stop(): Promise<void>;
  send(message: OutboundChannelMessage): Promise<SendResult>;
  probe(): Promise<ChannelProbeResult>;
}

export interface ChannelAdapterContext {
  readonly onMessage: (message: InboundChannelMessage) => Promise<void>;
  readonly logger: ChannelLogger;
  readonly config: Record<string, unknown>;
}

export interface SendResult {
  readonly success: boolean;
  readonly messageId?: string;
  readonly error?: string;
}

export interface ChannelProbeResult {
  readonly connected: boolean;
  readonly details?: Record<string, unknown>;
}

export interface ChannelLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

// ── Routing Helpers ──────────────────────────────────────────────────

export interface RoutedMessage {
  readonly conversationId: string;
  readonly message: InboundChannelMessage;
}

export interface OutboundRoute {
  readonly channelId: string;
  readonly accountId: string;
  readonly peerId: string;
  readonly threadId?: string;
}

// ── Channel Config ───────────────────────────────────────────────────

export interface ChannelConfig {
  readonly channelId: string;
  readonly enabled: boolean;
  readonly config: Record<string, unknown>;
}
