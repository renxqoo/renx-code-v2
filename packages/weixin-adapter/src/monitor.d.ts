import type { WeixinMessage } from "./api/types";
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
export interface WeixinMonitorOptions {
    baseUrl: string;
    cdnBaseUrl?: string;
    token?: string;
    accountId: string;
    abortSignal?: AbortSignal;
    longPollTimeoutMs?: number;
    onMessage: WeixinMessageHandler;
}
/**
 * Long-poll monitor: getUpdates -> parse -> call handler.
 * Runs until abortSignal fires.
 */
export declare function startWeixinMonitor(opts: WeixinMonitorOptions): Promise<void>;
//# sourceMappingURL=monitor.d.ts.map