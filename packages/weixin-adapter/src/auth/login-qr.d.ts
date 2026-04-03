/** Default bot_type for ilink get_bot_qrcode / get_qrcode_status. */
export declare const DEFAULT_ILINK_BOT_TYPE = "3";
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
export declare function startWeixinLoginWithQr(opts: {
    verbose?: boolean;
    timeoutMs?: number;
    force?: boolean;
    accountId?: string;
    apiBaseUrl?: string;
    botType?: string;
}): Promise<WeixinQrStartResult>;
/** Wait for QR code scan confirmation. Polls until confirmed or timeout. */
export declare function waitForWeixinLogin(opts: {
    timeoutMs?: number;
    verbose?: boolean;
    sessionKey: string;
    apiBaseUrl?: string;
    botType?: string;
}): Promise<WeixinQrWaitResult>;
//# sourceMappingURL=login-qr.d.ts.map