export {
  getUpdates,
  sendMessage,
  getConfig,
  sendTyping,
  getUploadUrl,
  apiGetFetch,
  buildBaseInfo,
  type WeixinApiOptions,
} from "./api";

export type {
  BaseInfo,
  GetUpdatesReq,
  GetUpdatesResp,
  SendMessageReq,
  SendTypingReq,
  GetConfigResp,
  GetUploadUrlReq,
  GetUploadUrlResp,
  WeixinMessage,
  MessageItem,
  TextItem,
  ImageItem,
  VoiceItem,
  FileItem,
  VideoItem,
  CDNMedia,
  RefMessage,
} from "./types";

export {
  MessageType,
  MessageItemType,
  MessageState,
  TypingStatus,
  UploadMediaType,
} from "./types";
