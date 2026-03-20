import type { SessionSummary } from '../agent/runtime/runtime';

const formatDate = (value: number): string => {
  return new Date(value).toISOString();
};

const quote = (value: string | undefined): string => {
  if (!value) {
    return '-';
  }
  return value.replace(/\s+/g, ' ').trim();
};

export const renderSessionList = (sessions: SessionSummary[]): string => {
  if (sessions.length === 0) {
    return 'No sessions found.';
  }

  return sessions
    .map((session) =>
      [
        `${session.conversationId}`,
        `updated=${formatDate(session.updatedAt)}`,
        `runs=${session.runCount}`,
        session.lastRunStatus ? `status=${session.lastRunStatus}` : undefined,
        session.lastUserMessageText ? `user=${quote(session.lastUserMessageText)}` : undefined,
        session.lastAssistantMessageText
          ? `assistant=${quote(session.lastAssistantMessageText)}`
          : undefined,
      ]
        .filter(Boolean)
        .join(' | ')
    )
    .join('\n');
};

export const renderSessionDetail = (session: SessionSummary | null): string => {
  if (!session) {
    return 'Session not found.';
  }

  return [
    `id: ${session.conversationId}`,
    `createdAt: ${formatDate(session.createdAt)}`,
    `updatedAt: ${formatDate(session.updatedAt)}`,
    `runCount: ${session.runCount}`,
    `lastRunStatus: ${session.lastRunStatus ?? '-'}`,
    `lastUserMessage: ${quote(session.lastUserMessageText)}`,
    `lastAssistantMessage: ${quote(session.lastAssistantMessageText)}`,
  ].join('\n');
};
