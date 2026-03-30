import { getUpdates } from "./api/api";
import { SESSION_EXPIRED_ERRCODE } from "./api/session-guard";
import {
  parseInboundMessage,
  restoreContextTokens,
  setContextToken,
} from "./messaging/inbound";
import { loadGetUpdatesBuf, saveGetUpdatesBuf, getSyncBufFilePath } from "./storage/sync-buf";
import { logger } from "./util/logger";
import type { WeixinMessage } from "./api/types";

// ---------------------------------------------------------------------------
// Message handler callback type
// ---------------------------------------------------------------------------

/** Simplified inbound message delivered to the handler. */
export interface WeixinInboundEvent {
  body: string;
  fromUserId: string;
  accountId: string;
  contextToken?: string;
  timestamp?: number;
  raw: WeixinMessage;
}

/** Handler called for each inbound message. */
export type WeixinMessageHandler = (event: WeixinInboundEvent) => Promise<void>;

// ---------------------------------------------------------------------------
// Monitor configuration
// ---------------------------------------------------------------------------

export interface WeixinMonitorOptions {
  baseUrl: string;
  cdnBaseUrl?: string;
  token?: string;
  accountId: string;
  abortSignal?: AbortSignal;
  longPollTimeoutMs?: number;
  onMessage: WeixinMessageHandler;
}

// ---------------------------------------------------------------------------
// Monitor implementation
// ---------------------------------------------------------------------------

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_DELAY_MS = 30_000;
const RETRY_DELAY_MS = 2_000;

/**
 * Long-poll monitor: getUpdates -> parse -> call handler.
 * Runs until abortSignal fires.
 */
export async function startWeixinMonitor(opts: WeixinMonitorOptions): Promise<void> {
  const {
    baseUrl,
    token,
    accountId,
    abortSignal,
    longPollTimeoutMs,
    onMessage,
  } = opts;

  const aLog = logger.withAccount(accountId);
  aLog.info(`Monitor starting: baseUrl=${baseUrl}`);

  const syncFilePath = getSyncBufFilePath(accountId);
  const previousBuf = loadGetUpdatesBuf(syncFilePath);
  let getUpdatesBuf = previousBuf ?? "";

  if (previousBuf) {
    aLog.debug(`Resuming from previous sync buf (${getUpdatesBuf.length} bytes)`);
  } else {
    aLog.info(`No previous sync buf, starting fresh`);
  }

  restoreContextTokens(accountId);

  let nextTimeoutMs = longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
  let consecutiveFailures = 0;

  while (!abortSignal?.aborted) {
    try {
      aLog.debug(`getUpdates: buf=${getUpdatesBuf.substring(0, 50)}... timeoutMs=${nextTimeoutMs}`);

      const resp = await getUpdates({
        baseUrl,
        token,
        get_updates_buf: getUpdatesBuf,
        timeoutMs: nextTimeoutMs,
      });

      aLog.debug(
        `getUpdates response: ret=${resp.ret}, msgs=${resp.msgs?.length ?? 0}`,
      );

      if (resp.longpolling_timeout_ms != null && resp.longpolling_timeout_ms > 0) {
        nextTimeoutMs = resp.longpolling_timeout_ms;
      }

      const isApiError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);

      if (isApiError) {
        const isSessionExpired =
          resp.errcode === SESSION_EXPIRED_ERRCODE ||
          resp.ret === SESSION_EXPIRED_ERRCODE;

        if (isSessionExpired) {
          aLog.error(`getUpdates: session expired (errcode=${resp.errcode}), pausing for 5 min`);
          consecutiveFailures = 0;
          await sleep(300_000, abortSignal);
          continue;
        }

        consecutiveFailures += 1;
        aLog.error(`getUpdates failed: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ""} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`);

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          aLog.error(`${MAX_CONSECUTIVE_FAILURES} consecutive failures, backing off 30s`);
          consecutiveFailures = 0;
          await sleep(BACKOFF_DELAY_MS, abortSignal);
        } else {
          await sleep(RETRY_DELAY_MS, abortSignal);
        }
        continue;
      }

      consecutiveFailures = 0;

      if (resp.get_updates_buf != null && resp.get_updates_buf !== "") {
        saveGetUpdatesBuf(syncFilePath, resp.get_updates_buf);
        getUpdatesBuf = resp.get_updates_buf;
      }

      const messages = resp.msgs ?? [];
      for (const msg of messages) {
        if (msg.message_type !== 1) {
          aLog.debug(`Skipping non-USER message: type=${msg.message_type}`);
          continue;
        }

        const fromUserId = msg.from_user_id ?? "";
        aLog.info(`inbound message: from=${fromUserId}`);

        if (msg.context_token && fromUserId) {
          setContextToken(accountId, fromUserId, msg.context_token);
        }

        const parsed = parseInboundMessage(msg, accountId);

        try {
          await onMessage({
            body: parsed.body,
            fromUserId: parsed.fromUserId,
            accountId: parsed.accountId,
            contextToken: parsed.contextToken,
            timestamp: parsed.timestamp,
            raw: msg,
          });
        } catch (handlerErr) {
          aLog.error(`onMessage handler error: ${String(handlerErr)}`);
        }
      }
    } catch (err) {
      if (abortSignal?.aborted) {
        aLog.info(`Monitor stopped (aborted)`);
        return;
      }
      consecutiveFailures += 1;
      aLog.error(`getUpdates error (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${String(err)}`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        consecutiveFailures = 0;
        await sleep(BACKOFF_DELAY_MS, abortSignal);
      } else {
        await sleep(RETRY_DELAY_MS, abortSignal);
      }
    }
  }

  aLog.info(`Monitor ended`);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}
