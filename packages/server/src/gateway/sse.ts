export interface SSEEvent {
  readonly data: string;
  readonly event?: string;
  readonly id?: string;
}

export function formatSSE(event: SSEEvent): string {
  let result = '';
  if (event.event) result += `event: ${event.event}\n`;
  if (event.id) result += `id: ${event.id}\n`;
  result += `data: ${event.data}\n\n`;
  return result;
}

export function formatSSEDone(): string {
  return 'data: [DONE]\n\n';
}

export function createOpenAIChunk(id: string, content: string, model: string): string {
  return JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: { content },
      finish_reason: null,
    }],
  });
}

export function createOpenAIFinishChunk(id: string, model: string): string {
  return JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: {},
      finish_reason: 'stop',
    }],
  });
}
