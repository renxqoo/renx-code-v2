import type { WeixinApiOptions } from "../api/api";
/**
 * Send a plain text message to a WeChat user via iLink Bot API.
 */
export declare function sendMessageWeixin(params: {
    to: string;
    text: string;
    opts: WeixinApiOptions & {
        contextToken?: string;
    };
}): Promise<{
    messageId: string;
}>;
/** Build an image MessageItem from CDN upload result. */
export declare function sendImageMessage(params: {
    to: string;
    text: string;
    downloadEncryptedQueryParam: string;
    aeskey: string;
    fileSizeCiphertext: number;
    opts: WeixinApiOptions & {
        contextToken?: string;
    };
}): Promise<{
    messageId: string;
}>;
//# sourceMappingURL=send.d.ts.map