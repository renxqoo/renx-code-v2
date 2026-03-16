export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ImageUrlContentPart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export interface InputAudioContentPart {
  type: 'input_audio';
  input_audio: {
    data: string;
    format: 'wav' | 'mp3';
  };
}

export interface InputVideoContentPart {
  type: 'input_video';
  input_video: {
    url?: string;
    file_id?: string;
    data?: string;
    format?: 'mp4' | 'mov' | 'webm';
  };
}

export interface FileContentPart {
  type: 'file';
  file: {
    file_id?: string;
    file_data?: string;
    filename?: string;
  };
}

export type InputContentPart =
  | TextContentPart
  | ImageUrlContentPart
  | InputAudioContentPart
  | InputVideoContentPart
  | FileContentPart;

export type MessageContent = string | InputContentPart[];
