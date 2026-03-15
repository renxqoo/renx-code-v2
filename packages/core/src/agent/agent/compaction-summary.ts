import type { LLMRequestMessage } from '../../providers';
import type { Message } from '../types';
import { contentToText } from '../utils/message';
import type { CompactionPromptVersion } from './compaction-prompt';

function formatMessageToolMetadata(message: Message): string[] {
  const toolMetadata: string[] = [];

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    for (const toolCall of message.tool_calls) {
      toolMetadata.push(
        `tool_call: ${toolCall.function?.name || 'unknown'} id=${toolCall.id || ''} args=${toolCall.function?.arguments || '{}'}`.trim()
      );
    }
  }

  if (typeof message.tool_call_id === 'string' && message.tool_call_id.trim().length > 0) {
    toolMetadata.push(`tool_call_id: ${message.tool_call_id}`);
  }

  return toolMetadata;
}

export function formatMessagesForCompaction(messages: Message[]): string {
  return messages
    .map((message, index) => {
      const text = contentToText(message.content).trim();
      const toolMetadata = formatMessageToolMetadata(message);

      const lines = [
        `<message index="${index}" role="${message.role}" type="${message.type}" id="${message.messageId}">`,
        text.length > 0 ? text : '(empty)',
        ...toolMetadata,
        '</message>',
      ];
      return lines.join('\n');
    })
    .join('\n');
}

export function buildCompactionRequestMessages(input: {
  pendingMessages: Message[];
  previousSummary: string;
  systemPrompt: string;
  promptVersion?: CompactionPromptVersion;
}): LLMRequestMessage[] {
  const { pendingMessages, previousSummary, systemPrompt, promptVersion = 'v1' } = input;
  const previousSummaryBlock = previousSummary
    ? `\n<previous_summary>\n${previousSummary}\n</previous_summary>`
    : '';
  const conversationBlock = `<conversation_to_summarize>\n${formatMessagesForCompaction(pendingMessages)}\n</conversation_to_summarize>`;

  if (promptVersion === 'v2') {
    return [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content:
          `<compaction_request version="v2">\n` +
          `<output_contract>\nReturn exactly one <summary>...</summary> block.\n</output_contract>\n` +
          `${conversationBlock}` +
          previousSummaryBlock +
          `\n</compaction_request>`,
      },
    ];
  }

  return [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: conversationBlock + previousSummaryBlock,
    },
  ];
}

export function extractSummaryContent(
  rawContent: string,
  promptVersion: CompactionPromptVersion = 'v1'
): string {
  const trimmed = rawContent.trim();
  if (!trimmed) {
    return '';
  }

  const summaryMatch = trimmed.match(/<summary>[\s\S]*?<\/summary>/i);
  if (summaryMatch) {
    return summaryMatch[0].trim();
  }

  if (promptVersion === 'v2') {
    return '';
  }

  return trimmed;
}

export function createSummaryMessage(summaryContent: string): Message {
  return {
    messageId: crypto.randomUUID(),
    role: 'user',
    type: 'summary',
    content: summaryContent,
    timestamp: Date.now(),
  };
}
