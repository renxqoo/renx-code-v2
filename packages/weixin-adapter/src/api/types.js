/**
 * Weixin iLink Bot protocol types.
 * Mirrors the proto definitions used by the iLink Bot API.
 * All bytes fields are base64 strings in JSON.
 */
/** proto: UploadMediaType */
export const UploadMediaType = {
    IMAGE: 1,
    VIDEO: 2,
    FILE: 3,
    VOICE: 4,
};
export const MessageType = {
    NONE: 0,
    USER: 1,
    BOT: 2,
};
export const MessageItemType = {
    NONE: 0,
    TEXT: 1,
    IMAGE: 2,
    VOICE: 3,
    FILE: 4,
    VIDEO: 5,
};
export const MessageState = {
    NEW: 0,
    GENERATING: 1,
    FINISH: 2,
};
/** Typing status: 1 = typing, 2 = cancel. */
export const TypingStatus = {
    TYPING: 1,
    CANCEL: 2,
};
