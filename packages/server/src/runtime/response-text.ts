import type { Message, MessageContent, Usage } from '@renx-code/core';

export function extractAssistantResponseText(messages: Message[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant') {
      return contentToText(message.content);
    }
  }
  return '';
}

export function extractUsageSummary(messages: Message[]): Usage {
  return messages.reduce<Usage>(
    (accumulator, message) => {
      if (message.role !== 'assistant' || !message.usage) {
        return accumulator;
      }
      accumulator.prompt_tokens += message.usage.prompt_tokens ?? 0;
      accumulator.completion_tokens += message.usage.completion_tokens ?? 0;
      accumulator.total_tokens += message.usage.total_tokens ?? 0;
      return accumulator;
    },
    {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    }
  );
}

function contentToText(content: MessageContent | undefined): string {
  if (!content) {
    return '';
  }
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      switch (part.type) {
        case 'text':
          return part.text || '';
        case 'image_url':
          return `[image] ${part.image_url?.url || ''}`.trim();
        case 'file':
          return `[file] ${part.file?.filename || part.file?.file_id || ''}`.trim();
        case 'input_audio':
          return '[audio]';
        case 'input_video':
          return `[video] ${part.input_video?.url || part.input_video?.file_id || ''}`.trim();
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}
