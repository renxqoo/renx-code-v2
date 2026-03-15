import type { Message } from '../types';
import { contentToText, processToolCallPairs } from '../utils/message';

export type CompactionSelection = {
  systemMessage: Message | undefined;
  activeMessages: Message[];
  pendingMessages: Message[];
  previousSummary: string;
};

function splitMessages(
  messages: Message[],
  keepMessagesNum: number
): {
  systemMessage: Message | undefined;
  pending: Message[];
  active: Message[];
} {
  const systemMessage = messages.find((message) => message.role === 'system');
  const nonSystemMessages = messages.filter((message) => message.role !== 'system');

  let lastUserIndex = -1;
  for (let index = nonSystemMessages.length - 1; index >= 0; index -= 1) {
    if (nonSystemMessages[index].role === 'user') {
      lastUserIndex = index;
      break;
    }
  }

  let splitPoint = nonSystemMessages.length - keepMessagesNum;
  if (lastUserIndex !== -1 && lastUserIndex < splitPoint) {
    // Even when keepMessagesNum is 0, we still keep the latest user turn active
    // so compaction never replaces the entire recent raw context with summary text.
    splitPoint = lastUserIndex;
  }

  splitPoint = Math.max(0, splitPoint);

  return {
    systemMessage,
    pending: nonSystemMessages.slice(0, splitPoint),
    active: nonSystemMessages.slice(splitPoint),
  };
}

/**
 * Select the message windows used by compaction v2.
 *
 * We only summarize the history that is about to be removed. Recent active
 * messages remain untouched so the post-compaction request shape is predictable
 * and continuation/cache behavior stays easier to reason about.
 */
export function selectCompactionWindow(
  messages: Message[],
  keepMessagesNum: number
): CompactionSelection {
  const { systemMessage, pending, active } = splitMessages(messages, keepMessagesNum);
  const { pending: pairedPending, active: pairedActive } = processToolCallPairs(pending, active);

  const summaryMessages = pairedPending.filter((message) => message.type === 'summary');
  const latestSummary = summaryMessages.at(-1);
  const pendingMessages = pairedPending.filter((message) => message.type !== 'summary');

  return {
    systemMessage,
    activeMessages: pairedActive,
    pendingMessages,
    previousSummary: latestSummary ? contentToText(latestSummary.content).trim() : '',
  };
}
