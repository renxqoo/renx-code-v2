import type { BaseInfo, GetUploadUrlReq, GetUploadUrlResp, GetUpdatesReq, GetUpdatesResp, SendMessageReq, SendTypingReq, GetConfigResp } from "./types";
export type WeixinApiOptions = {
    baseUrl: string;
    token?: string;
    timeoutMs?: number;
    longPollTimeoutMs?: number;
};
/** Build the `base_info` payload included in every API request. */
export declare function buildBaseInfo(): BaseInfo;
/**
 * GET fetch wrapper.
 */
export declare function apiGetFetch(params: {
    baseUrl: string;
    endpoint: string;
    timeoutMs: number;
    label: string;
}): Promise<string>;
/**
 * Long-poll getUpdates. Server holds the request until new messages or timeout.
 */
export declare function getUpdates(params: GetUpdatesReq & {
    baseUrl: string;
    token?: string;
    timeoutMs?: number;
}): Promise<GetUpdatesResp>;
/** Get a pre-signed CDN upload URL for a file. */
export declare function getUploadUrl(params: GetUploadUrlReq & WeixinApiOptions): Promise<GetUploadUrlResp>;
/** Send a single message downstream. */
export declare function sendMessage(params: WeixinApiOptions & {
    body: SendMessageReq;
}): Promise<void>;
/** Fetch bot config (includes typing_ticket) for a given user. */
export declare function getConfig(params: WeixinApiOptions & {
    ilinkUserId: string;
    contextToken?: string;
}): Promise<GetConfigResp>;
/** Send a typing indicator to a user. */
export declare function sendTyping(params: WeixinApiOptions & {
    body: SendTypingReq;
}): Promise<void>;
//# sourceMappingURL=api.d.ts.map