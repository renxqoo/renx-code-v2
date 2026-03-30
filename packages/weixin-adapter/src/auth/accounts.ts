import fs from "node:fs";
import path from "node:path";

import { logger } from "../util/logger";
import { resolveStateDir } from "../storage/state-dir";

// ---------------------------------------------------------------------------
// Account ID normalization (replaces openclaw/plugin-sdk/account-id)
// ---------------------------------------------------------------------------

/**
 * Normalize a raw Weixin account ID to a filesystem-safe key.
 * e.g. "b0f5860fdecb@im.bot" → "b0f5860fdecb-im-bot"
 */
export function normalizeAccountId(raw: string): string {
  return raw.trim().replace(/[@.]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

// ---------------------------------------------------------------------------
// Account store (file-based, no openclaw config dependency)
// ---------------------------------------------------------------------------

function resolveWeixinStateDir(): string {
  return path.join(resolveStateDir(), "weixin");
}

function resolveAccountIndexPath(): string {
  return path.join(resolveWeixinStateDir(), "accounts.json");
}

/** Returns all accountIds registered via QR login. */
export function listAccountIds(): string[] {
  const filePath = resolveAccountIndexPath();
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id: unknown): id is string => typeof id === "string" && id.trim() !== "");
  } catch {
    return [];
  }
}

/** Add accountId to the persistent index. */
export function registerAccountId(accountId: string): void {
  const dir = resolveWeixinStateDir();
  fs.mkdirSync(dir, { recursive: true });

  const existing = listAccountIds();
  if (existing.includes(accountId)) return;

  const updated = [...existing, accountId];
  fs.writeFileSync(resolveAccountIndexPath(), JSON.stringify(updated, null, 2), "utf-8");
}

/** Remove accountId from the persistent index. */
export function unregisterAccountId(accountId: string): void {
  const existing = listAccountIds();
  const updated = existing.filter((id) => id !== accountId);
  if (updated.length !== existing.length) {
    fs.writeFileSync(resolveAccountIndexPath(), JSON.stringify(updated, null, 2), "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Per-account credential files
// ---------------------------------------------------------------------------

export type WeixinAccountData = {
  token?: string;
  savedAt?: string;
  baseUrl?: string;
  userId?: string;
  cdnBaseUrl?: string;
};

function resolveAccountsDir(): string {
  return path.join(resolveWeixinStateDir(), "accounts");
}

function resolveAccountPath(accountId: string): string {
  return path.join(resolveAccountsDir(), `${accountId}.json`);
}

function readAccountFile(filePath: string): WeixinAccountData | null {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as WeixinAccountData;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Load account data by ID. */
export function loadAccount(accountId: string): WeixinAccountData | null {
  const normalized = normalizeAccountId(accountId);
  return readAccountFile(resolveAccountPath(normalized));
}

/** Save/update account data after QR login. */
export function saveAccount(
  accountId: string,
  update: { token?: string; baseUrl?: string; userId?: string; cdnBaseUrl?: string },
): void {
  const dir = resolveAccountsDir();
  fs.mkdirSync(dir, { recursive: true });

  const normalized = normalizeAccountId(accountId);
  const existing = loadAccount(normalized) ?? {};

  const data: WeixinAccountData = {
    ...(existing.token ? { token: existing.token } : {}),
    ...(existing.savedAt ? { savedAt: existing.savedAt } : {}),
    ...(existing.baseUrl ? { baseUrl: existing.baseUrl } : {}),
    ...(existing.userId ? { userId: existing.userId } : {}),
    ...(existing.cdnBaseUrl ? { cdnBaseUrl: existing.cdnBaseUrl } : {}),
    ...(update.token ? { token: update.token, savedAt: new Date().toISOString() } : {}),
    ...(update.baseUrl ? { baseUrl: update.baseUrl } : {}),
    ...(update.userId !== undefined ? { userId: update.userId || undefined } : {}),
    ...(update.cdnBaseUrl ? { cdnBaseUrl: update.cdnBaseUrl } : {}),
  };

  const filePath = resolveAccountPath(normalized);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort on Windows
  }
}

/** Remove account files. */
export function clearAccount(accountId: string): void {
  const normalized = normalizeAccountId(accountId);
  const dir = resolveAccountsDir();
  const files = [`${normalized}.json`, `${normalized}.sync.json`, `${normalized}.context-tokens.json`];
  for (const file of files) {
    try {
      fs.unlinkSync(path.join(dir, file));
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Resolved account (merged credentials for use at runtime)
// ---------------------------------------------------------------------------

export type ResolvedWeixinAccount = {
  accountId: string;
  baseUrl: string;
  cdnBaseUrl: string;
  token?: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
};

/** Resolve an account by ID, merging stored credentials with defaults. */
export function resolveAccount(accountId: string): ResolvedWeixinAccount {
  const normalized = normalizeAccountId(accountId);
  const data = loadAccount(normalized);
  const token = data?.token?.trim() || undefined;
  const baseUrl = data?.baseUrl?.trim() || DEFAULT_BASE_URL;
  const cdnBaseUrl = data?.cdnBaseUrl?.trim() || CDN_BASE_URL;

  return {
    accountId: normalized,
    baseUrl,
    cdnBaseUrl,
    token,
    enabled: true,
    configured: Boolean(token),
  };
}

/** Get the first configured account, or null. */
export function getFirstConfiguredAccount(): ResolvedWeixinAccount | null {
  const ids = listAccountIds();
  for (const id of ids) {
    const account = resolveAccount(id);
    if (account.configured) return account;
  }
  return null;
}
