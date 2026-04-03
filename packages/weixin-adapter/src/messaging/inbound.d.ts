import type { WeixinMessage, MessageItem } from "../api/types";
/** Restore persisted context tokens for an account. */
export declare function restoreContextTokens(accountId: string): void;
/** Remove all context tokens for a given account. */
export declare function clearContextTokensForAccount(accountId: string): void;
/** Store a context token. */
export declare function setContextToken(accountId: string, userId: string, token: string): void;
/** Retrieve the cached context token. */
export declare function getContextToken(accountId: string, userId: string): string | undefined;
export type WeixinInboundMessage = {
    body: string;
    fromUserId: string;
    toUserId: string;
    accountId: string;
    contextToken?: string;
    timestamp?: number;
    mediaPath?: string;
    mediaType?: string;
};
/** Returns true if the message item is a media type. */
export declare function isMediaItem(item: MessageItem): boolean;
/** Convert a raw WeixinMessage to our simplified InboundMessage. */
export declare function parseInboundMessage(msg: WeixinMessage, accountId: string): WeixinInboundMessage;
//# sourceMappingURL=inbound.d.ts.map