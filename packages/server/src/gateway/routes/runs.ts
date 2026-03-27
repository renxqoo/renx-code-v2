import type {
  AgentAppService,
  ListConversationEventsOptions,
  RunForegroundRequest,
  SqliteAgentAppStore,
} from '@renx-code/core';

import { HttpError } from '../errors';
import { extractAssistantResponseText } from '../../runtime/response-text';
import { resolveConversationId } from '../../runtime/session-key';

interface CreateRunBody {
  conversationId?: string;
  executionId?: string;
  userInput?: string;
  historyMessages?: RunForegroundRequest['historyMessages'];
  systemPrompt?: string;
  maxSteps?: number;
  model?: string;
}

export async function createRun(
  appService: AgentAppService,
  body: CreateRunBody,
  principal: RunForegroundRequest['principal']
) {
  const userInput = body.userInput?.trim();
  if (!userInput) {
    throw new HttpError(400, 'INVALID_REQUEST', 'userInput is required');
  }

  const conversationId = resolveConversationId({ conversationId: body.conversationId });
  const result = await appService.runForeground({
    conversationId,
    executionId: body.executionId,
    userInput,
    historyMessages: body.historyMessages,
    systemPrompt: body.systemPrompt,
    principal,
    maxSteps: body.maxSteps,
    config: body.model ? { model: body.model } : undefined,
    modelLabel: body.model,
  });

  return {
    executionId: result.executionId,
    conversationId: result.conversationId,
    finishReason: result.finishReason,
    status: result.run.status,
    responseText: extractAssistantResponseText(result.messages),
    run: result.run,
  };
}

export async function getRun(appService: AgentAppService, executionId: string) {
  const run = await appService.getRun(executionId);
  if (!run) {
    throw new HttpError(404, 'RUN_NOT_FOUND', `Run not found: ${executionId}`);
  }
  return run;
}

export async function listRuns(
  appService: AgentAppService,
  input: {
    conversationId?: string;
    limit?: number;
    statuses?: Array<'CREATED' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'>;
  }
) {
  const conversationId = input.conversationId?.trim();
  if (!conversationId) {
    throw new HttpError(400, 'INVALID_REQUEST', 'conversationId is required');
  }
  return appService.listRuns(conversationId, {
    limit: input.limit,
    statuses: input.statuses,
  });
}

export async function appendRunInput(
  appService: AgentAppService,
  executionId: string,
  body: { conversationId?: string; userInput?: string }
) {
  const conversationId = body.conversationId?.trim();
  const userInput = body.userInput?.trim();
  if (!conversationId || !userInput) {
    throw new HttpError(400, 'INVALID_REQUEST', 'conversationId and userInput are required');
  }

  return appService.appendUserInputToRun({
    executionId,
    conversationId,
    userInput,
  });
}

export async function listConversationEvents(
  store: SqliteAgentAppStore,
  conversationId: string,
  opts: ListConversationEventsOptions = {}
) {
  const items = await store.listEventsByConversation(conversationId, opts);
  return { items };
}
