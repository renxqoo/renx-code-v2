import { randomUUID } from "node:crypto";

import { apiGetFetch } from "../api/api";
import { logger } from "../util/logger";
import { redactToken } from "../util/redact";

type ActiveLogin = {
  sessionKey: string;
  id: string;
  qrcode: string;
  qrcodeUrl: string;
  startedAt: number;
  botToken?: string;
  status?: "wait" | "scaned" | "confirmed" | "expired" | "scaned_but_redirect";
  error?: string;
  currentApiBaseUrl?: string;
};

const ACTIVE_LOGIN_TTL_MS = 5 * 60_000;
const GET_QRCODE_TIMEOUT_MS = 5_000;
const QR_LONG_POLL_TIMEOUT_MS = 35_000;

/** Default bot_type for ilink get_bot_qrcode / get_qrcode_status. */
export const DEFAULT_ILINK_BOT_TYPE = "3";

const FIXED_BASE_URL = "https://ilinkai.weixin.qq.com";

const activeLogins = new Map<string, ActiveLogin>();

interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

interface StatusResponse {
  status: "wait" | "scaned" | "confirmed" | "expired" | "scaned_but_redirect";
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}

function isLoginFresh(login: ActiveLogin): boolean {
  return Date.now() - login.startedAt < ACTIVE_LOGIN_TTL_MS;
}

function purgeExpiredLogins(): void {
  for (const [id, login] of activeLogins) {
    if (!isLoginFresh(login)) {
      activeLogins.delete(id);
    }
  }
}

async function fetchQRCode(apiBaseUrl: string, botType: string): Promise<QRCodeResponse> {
  logger.info(`Fetching QR code from: ${apiBaseUrl} bot_type=${botType}`);
  const rawText = await apiGetFetch({
    baseUrl: apiBaseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    timeoutMs: GET_QRCODE_TIMEOUT_MS,
    label: "fetchQRCode",
  });
  return JSON.parse(rawText) as QRCodeResponse;
}

async function pollQRStatus(apiBaseUrl: string, qrcode: string): Promise<StatusResponse> {
  logger.debug(`Long-poll QR status from: ${apiBaseUrl}`);
  try {
    const rawText = await apiGetFetch({
      baseUrl: apiBaseUrl,
      endpoint: `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      timeoutMs: QR_LONG_POLL_TIMEOUT_MS,
      label: "pollQRStatus",
    });
    return JSON.parse(rawText) as StatusResponse;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { status: "wait" };
    }
    logger.warn(`pollQRStatus: network/gateway error, will retry: ${String(err)}`);
    return { status: "wait" };
  }
}

export type WeixinQrStartResult = {
  qrcodeUrl?: string;
  message: string;
  sessionKey: string;
};

export type WeixinQrWaitResult = {
  connected: boolean;
  botToken?: string;
  accountId?: string;
  baseUrl?: string;
  userId?: string;
  message: string;
};

/** Start a QR code login session. Returns QR URL and sessionKey. */
export async function startWeixinLoginWithQr(opts: {
  verbose?: boolean;
  timeoutMs?: number;
  force?: boolean;
  accountId?: string;
  apiBaseUrl?: string;
  botType?: string;
}): Promise<WeixinQrStartResult> {
  const sessionKey = opts.accountId || randomUUID();

  purgeExpiredLogins();

  const existing = activeLogins.get(sessionKey);
  if (!opts.force && existing && isLoginFresh(existing) && existing.qrcodeUrl) {
    return {
      qrcodeUrl: existing.qrcodeUrl,
      message: "QR code ready. Please scan with WeChat.",
      sessionKey,
    };
  }

  try {
    const botType = opts.botType || DEFAULT_ILINK_BOT_TYPE;
    const apiBase = opts.apiBaseUrl || FIXED_BASE_URL;
    logger.info(`Starting Weixin login with bot_type=${botType}`);

    const qrResponse = await fetchQRCode(apiBase, botType);
    logger.info(
      `QR code received, qrcode=${redactToken(qrResponse.qrcode)} imgContentLen=${qrResponse.qrcode_img_content?.length ?? 0}`,
    );

    const login: ActiveLogin = {
      sessionKey,
      id: randomUUID(),
      qrcode: qrResponse.qrcode,
      qrcodeUrl: qrResponse.qrcode_img_content,
      startedAt: Date.now(),
    };

    activeLogins.set(sessionKey, login);

    return {
      qrcodeUrl: qrResponse.qrcode_img_content,
      message: "Scan the QR code with WeChat to connect.",
      sessionKey,
    };
  } catch (err) {
    logger.error(`Failed to start Weixin login: ${String(err)}`);
    return {
      message: `Failed to start login: ${String(err)}`,
      sessionKey,
    };
  }
}

const MAX_QR_REFRESH_COUNT = 3;

/** Wait for QR code scan confirmation. Polls until confirmed or timeout. */
export async function waitForWeixinLogin(opts: {
  timeoutMs?: number;
  verbose?: boolean;
  sessionKey: string;
  apiBaseUrl?: string;
  botType?: string;
}): Promise<WeixinQrWaitResult> {
  let activeLogin = activeLogins.get(opts.sessionKey);

  if (!activeLogin) {
    return { connected: false, message: "No active login session. Please start login first." };
  }

  if (!isLoginFresh(activeLogin)) {
    activeLogins.delete(opts.sessionKey);
    return { connected: false, message: "QR code expired. Please restart login." };
  }

  const timeoutMs = Math.max(opts.timeoutMs ?? 480_000, 1000);
  const deadline = Date.now() + timeoutMs;
  let qrRefreshCount = 1;

  activeLogin.currentApiBaseUrl = opts.apiBaseUrl || FIXED_BASE_URL;

  logger.info("Starting to poll QR code status...");

  while (Date.now() < deadline) {
    try {
      const currentBaseUrl = activeLogin.currentApiBaseUrl ?? FIXED_BASE_URL;
      const statusResponse = await pollQRStatus(currentBaseUrl, activeLogin.qrcode);
      activeLogin.status = statusResponse.status;

      switch (statusResponse.status) {
        case "wait":
          break;

        case "scaned":
          if (opts.verbose) {
            process.stdout.write("\nScanned! Continue in WeChat...\n");
          }
          break;

        case "expired": {
          qrRefreshCount++;
          if (qrRefreshCount > MAX_QR_REFRESH_COUNT) {
            activeLogins.delete(opts.sessionKey);
            return { connected: false, message: "Login timeout: QR expired too many times." };
          }

          logger.info(`QR expired, refreshing (${qrRefreshCount}/${MAX_QR_REFRESH_COUNT})`);
          try {
            const botType = opts.botType || DEFAULT_ILINK_BOT_TYPE;
            const qrResponse = await fetchQRCode(FIXED_BASE_URL, botType);
            activeLogin.qrcode = qrResponse.qrcode;
            activeLogin.qrcodeUrl = qrResponse.qrcode_img_content;
            activeLogin.startedAt = Date.now();
          } catch (refreshErr) {
            activeLogins.delete(opts.sessionKey);
            return { connected: false, message: `QR refresh failed: ${String(refreshErr)}` };
          }
          break;
        }

        case "scaned_but_redirect": {
          const redirectHost = statusResponse.redirect_host;
          if (redirectHost) {
            activeLogin.currentApiBaseUrl = `https://${redirectHost}`;
            logger.info(`IDC redirect, switching to ${redirectHost}`);
          }
          break;
        }

        case "confirmed": {
          if (!statusResponse.ilink_bot_id) {
            activeLogins.delete(opts.sessionKey);
            return { connected: false, message: "Login failed: server did not return ilink_bot_id." };
          }

          activeLogin.botToken = statusResponse.bot_token;
          activeLogins.delete(opts.sessionKey);

          logger.info(`Login confirmed! ilink_bot_id=${statusResponse.ilink_bot_id}`);

          return {
            connected: true,
            botToken: statusResponse.bot_token,
            accountId: statusResponse.ilink_bot_id,
            baseUrl: statusResponse.baseurl,
            userId: statusResponse.ilink_user_id,
            message: "WeChat connected successfully!",
          };
        }
      }
    } catch (err) {
      logger.error(`Error polling QR status: ${String(err)}`);
      activeLogins.delete(opts.sessionKey);
      return { connected: false, message: `Login failed: ${String(err)}` };
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  activeLogins.delete(opts.sessionKey);
  return { connected: false, message: "Login timed out. Please retry." };
}
