import type { ServerResponse } from 'node:http';

export function handleHealth(response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ ok: true }));
}
