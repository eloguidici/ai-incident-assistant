import { createServer } from 'node:http';

const successDelayMs = Number(process.env.SUCCESS_DELAY_MS);
const deadlineMs = Number(process.env.DEADLINE_MS);

createServer((request, response) => {
  if (request.url === '/api/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  const isDeadline = request.url === '/api/deadline';
  // Send no headers until completion, matching a non-streaming AI request.
  const timer = setTimeout(() => {
    response.writeHead(isDeadline ? 504 : 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(isDeadline ? { code: 'PROVIDER_TIMEOUT' } : { completed: true }));
  }, isDeadline ? deadlineMs : successDelayMs);
  response.on('close', () => clearTimeout(timer));
}).listen(3000, '0.0.0.0');
