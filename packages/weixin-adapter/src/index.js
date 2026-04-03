/**
 * @renx-code/weixin-adapter
 *
 * WeChat (Weixin) iLink Bot API adapter for renx-code.
 * Extracted from @tencent-weixin/openclaw-weixin with all openclaw dependencies removed.
 */
// ---------------------------------------------------------------------------
// API layer
// ---------------------------------------------------------------------------
export { getUpdates, sendMessage as sendMessageApi, getConfig, sendTyping, getUploadUrl, apiGetFetch, buildBaseInfo, } from "./api/api";
export { SESSION_EXPIRED_ERRCODE, assertSessionActive } from "./api/session-guard";
export { WeixinConfigManager } from "./api/config-cache";
export { MessageType, MessageItemType, MessageState, TypingStatus, UploadMediaType, } from "./api/types";
// ---------------------------------------------------------------------------
// Auth / Accounts
// ---------------------------------------------------------------------------
export { normalizeAccountId, DEFAULT_BASE_URL, CDN_BASE_URL, listAccountIds, registerAccountId, unregisterAccountId, loadAccount, saveAccount, clearAccount, resolveAccount, getFirstConfiguredAccount, } from "./auth/accounts";
export { DEFAULT_ILINK_BOT_TYPE, startWeixinLoginWithQr, waitForWeixinLogin, } from "./auth/login-qr";
// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------
export { sendMessageWeixin, sendImageMessage } from "./messaging/send";
export { parseInboundMessage, setContextToken, getContextToken, restoreContextTokens, clearContextTokensForAccount, isMediaItem, } from "./messaging/inbound";
export { markdownToPlainText, stripMarkdown } from "./messaging/markdown";
// ---------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------
export { startWeixinMonitor, } from "./monitor";
// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export { WeixinConfigSchema } from "./config/config-schema";
// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
export { resolveStateDir, resolveTempDir } from "./storage/state-dir";
export { getSyncBufFilePath, loadGetUpdatesBuf, saveGetUpdatesBuf } from "./storage/sync-buf";
// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
export { logger, setLogLevel } from "./util/logger";
export { generateId } from "./util/random";
export { redactToken, redactUrl, redactBody } from "./util/redact";
