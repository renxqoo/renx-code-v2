import { sendMessage as sendMessageApi } from "../api/api";
import { logger } from "../util/logger";
import { generateId } from "../util/random";
import { MessageItemType, MessageState, MessageType } from "../api/types";
import { markdownToPlainText } from "./markdown";
function generateClientId() {
    return generateId("renx-weixin");
}
/** Build a SendMessageReq containing a single text message. */
function buildTextMessageReq(params) {
    const { to, text, contextToken, clientId } = params;
    const item_list = text
        ? [{ type: MessageItemType.TEXT, text_item: { text } }]
        : [];
    return {
        msg: {
            from_user_id: "",
            to_user_id: to,
            client_id: clientId,
            message_type: MessageType.BOT,
            message_state: MessageState.FINISH,
            item_list: item_list.length ? item_list : undefined,
            context_token: contextToken ?? undefined,
        },
    };
}
/**
 * Send a plain text message to a WeChat user via iLink Bot API.
 */
export async function sendMessageWeixin(params) {
    const { to, text, opts } = params;
    if (!opts.contextToken) {
        logger.warn(`sendMessageWeixin: contextToken missing for to=${to}, sending without context`);
    }
    const clientId = generateClientId();
    const plainText = markdownToPlainText(text);
    const req = buildTextMessageReq({
        to,
        text: plainText,
        contextToken: opts.contextToken,
        clientId,
    });
    try {
        await sendMessageApi({
            baseUrl: opts.baseUrl,
            token: opts.token,
            timeoutMs: opts.timeoutMs,
            body: req,
        });
    }
    catch (err) {
        logger.error(`sendMessageWeixin: failed to=${to} clientId=${clientId} err=${String(err)}`);
        throw err;
    }
    return { messageId: clientId };
}
/**
 * Send one or more MessageItems downstream.
 * Each item is sent as its own request so that item_list always has exactly one entry.
 */
async function sendMediaItems(params) {
    const { to, text, mediaItem, opts, label } = params;
    const items = [];
    if (text) {
        items.push({ type: MessageItemType.TEXT, text_item: { text: markdownToPlainText(text) } });
    }
    items.push(mediaItem);
    let lastClientId = "";
    for (const item of items) {
        lastClientId = generateClientId();
        const req = {
            msg: {
                from_user_id: "",
                to_user_id: to,
                client_id: lastClientId,
                message_type: MessageType.BOT,
                message_state: MessageState.FINISH,
                item_list: [item],
                context_token: opts.contextToken ?? undefined,
            },
        };
        try {
            await sendMessageApi({
                baseUrl: opts.baseUrl,
                token: opts.token,
                timeoutMs: opts.timeoutMs,
                body: req,
            });
        }
        catch (err) {
            logger.error(`${label}: failed to=${to} clientId=${lastClientId} err=${String(err)}`);
            throw err;
        }
    }
    logger.info(`${label}: success to=${to} clientId=${lastClientId}`);
    return { messageId: lastClientId };
}
/** Build an image MessageItem from CDN upload result. */
export async function sendImageMessage(params) {
    const imageItem = {
        type: MessageItemType.IMAGE,
        image_item: {
            media: {
                encrypt_query_param: params.downloadEncryptedQueryParam,
                aes_key: Buffer.from(params.aeskey).toString("base64"),
                encrypt_type: 1,
            },
            mid_size: params.fileSizeCiphertext,
        },
    };
    return sendMediaItems({
        to: params.to,
        text: params.text,
        mediaItem: imageItem,
        opts: params.opts,
        label: "sendImageMessage",
    });
}
