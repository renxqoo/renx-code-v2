/**
 * Normalize a raw Weixin account ID to a filesystem-safe key.
 * e.g. "b0f5860fdecb@im.bot" → "b0f5860fdecb-im-bot"
 */
export declare function normalizeAccountId(raw: string): string;
export declare const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export declare const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
/** Returns all accountIds registered via QR login. */
export declare function listAccountIds(): string[];
/** Add accountId to the persistent index. */
export declare function registerAccountId(accountId: string): void;
/** Remove accountId from the persistent index. */
export declare function unregisterAccountId(accountId: string): void;
export type WeixinAccountData = {
    token?: string;
    savedAt?: string;
    baseUrl?: string;
    userId?: string;
    cdnBaseUrl?: string;
};
/** Load account data by ID. */
export declare function loadAccount(accountId: string): WeixinAccountData | null;
/** Save/update account data after QR login. */
export declare function saveAccount(accountId: string, update: {
    token?: string;
    baseUrl?: string;
    userId?: string;
    cdnBaseUrl?: string;
}): void;
/** Remove account files. */
export declare function clearAccount(accountId: string): void;
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
export declare function resolveAccount(accountId: string): ResolvedWeixinAccount;
/** Get the first configured account, or null. */
export declare function getFirstConfiguredAccount(): ResolvedWeixinAccount | null;
//# sourceMappingURL=accounts.d.ts.map