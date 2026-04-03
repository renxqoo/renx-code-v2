import fs from "node:fs";
import path from "node:path";
import { logger } from "../util/logger";
import { MessageItemType } from "../api/types";
import { resolveStateDir } from "../storage/state-dir";
// ---------------------------------------------------------------------------
// Context token store (in-process cache + disk persistence)
// ---------------------------------------------------------------------------
const contextTokenStore = new Map();
function contextTokenKey(accountId, userId) {
    return `${accountId}:${userId}`;
}
function resolveContextTokenFilePath(accountId) {
    return path.join(resolveStateDir(), "weixin", "accounts", `${accountId}.context-tokens.json`);
}
function persistContextTokens(accountId) {
    const prefix = `${accountId}:`;
    const tokens = {};
    for (const [k, v] of contextTokenStore) {
        if (k.startsWith(prefix)) {
            tokens[k.slice(prefix.length)] = v;
        }
    }
    const filePath = resolveContextTokenFilePath(accountId);
    try {
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(tokens, null, 0), "utf-8");
    }
    catch (err) {
        logger.warn(`persistContextTokens: failed to write ${filePath}: ${String(err)}`);
    }
}
/** Restore persisted context tokens for an account. */
export function restoreContextTokens(accountId) {
    const filePath = resolveContextTokenFilePath(accountId);
    try {
        if (!fs.existsSync(filePath))
            return;
        const raw = fs.readFileSync(filePath, "utf-8");
        const tokens = JSON.parse(raw);
        let count = 0;
        for (const [userId, token] of Object.entries(tokens)) {
            if (typeof token === "string" && token) {
                contextTokenStore.set(contextTokenKey(accountId, userId), token);
                count++;
            }
        }
        logger.info(`restoreContextTokens: restored ${count} tokens for account=${accountId}`);
    }
    catch (err) {
        logger.warn(`restoreContextTokens: failed to read ${filePath}: ${String(err)}`);
    }
}
/** Remove all context tokens for a given account. */
export function clearContextTokensForAccount(accountId) {
    const prefix = `${accountId}:`;
    for (const k of [...contextTokenStore.keys()]) {
        if (k.startsWith(prefix)) {
            contextTokenStore.delete(k);
        }
    }
    const filePath = resolveContextTokenFilePath(accountId);
    try {
        if (fs.existsSync(filePath))
            fs.unlinkSync(filePath);
    }
    catch (err) {
        logger.warn(`clearContextTokensForAccount: failed to remove ${filePath}: ${String(err)}`);
    }
}
/** Store a context token. */
export function setContextToken(accountId, userId, token) {
    contextTokenStore.set(contextTokenKey(accountId, userId), token);
    persistContextTokens(accountId);
}
/** Retrieve the cached context token. */
export function getContextToken(accountId, userId) {
    return contextTokenStore.get(contextTokenKey(accountId, userId));
}
function bodyFromItemList(itemList) {
    if (!itemList?.length)
        return "";
    for (const item of itemList) {
        if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
            const text = String(item.text_item.text);
            const ref = item.ref_msg;
            if (!ref)
                return text;
            if (ref.message_item && isMediaItem(ref.message_item))
                return text;
            const parts = [];
            if (ref.title)
                parts.push(ref.title);
            if (ref.message_item) {
                const refBody = bodyFromItemList([ref.message_item]);
                if (refBody)
                    parts.push(refBody);
            }
            if (!parts.length)
                return text;
            return `[Quote: ${parts.join(" | ")}]\n${text}`;
        }
        if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
            return item.voice_item.text;
        }
    }
    return "";
}
/** Returns true if the message item is a media type. */
export function isMediaItem(item) {
    return (item.type === MessageItemType.IMAGE ||
        item.type === MessageItemType.VIDEO ||
        item.type === MessageItemType.FILE ||
        item.type === MessageItemType.VOICE);
}
/** Convert a raw WeixinMessage to our simplified InboundMessage. */
export function parseInboundMessage(msg, accountId) {
    const fromUserId = msg.from_user_id ?? "";
    return {
        body: bodyFromItemList(msg.item_list),
        fromUserId,
        toUserId: fromUserId, // In DMs, reply to sender
        accountId,
        contextToken: msg.context_token,
        timestamp: msg.create_time_ms,
    };
}
