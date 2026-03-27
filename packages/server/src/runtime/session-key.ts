import { createHash, randomUUID } from 'node:crypto';

export interface ResolveConversationIdInput {
  conversationId?: string;
  user?: string;
}

export function resolveConversationId(input: ResolveConversationIdInput): string {
  const explicit = input.conversationId?.trim();
  if (explicit) {
    return explicit;
  }

  const user = input.user?.trim();
  if (user) {
    const digest = createHash('sha1').update(user).digest('hex').slice(0, 16);
    return `conv_${digest}`;
  }

  return `conv_${randomUUID().replace(/-/g, '')}`;
}
