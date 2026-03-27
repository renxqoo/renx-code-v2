import type { ServerResponse } from 'node:http';

export function openSse(response: ServerResponse): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
}

export function writeSseData(response: ServerResponse, payload: unknown): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function writeSseDone(response: ServerResponse): void {
  response.write('data: [DONE]\n\n');
}
