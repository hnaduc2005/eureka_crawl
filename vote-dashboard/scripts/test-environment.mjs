import http from 'node:http';
import { createDemoTestEnvironment } from '../testing/test-kit.mjs';

const port = Number(process.env.TEST_ENV_PORT || 8790);
const allowedOrigin = new URL(process.env.TEST_DASHBOARD_ORIGIN || 'http://127.0.0.1:8787').origin;
const sandbox = createDemoTestEnvironment();
const server = http.createServer(async (request, response) => {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (request.headers.origin && request.headers.origin !== allowedOrigin) {
    response.writeHead(403, headers);
    response.end(JSON.stringify({ error: 'Origin is not allowed for this local test environment.' }));
    return;
  }
  if (request.headers.origin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Accept' });
    response.end();
    return;
  }
  try {
    const url = new URL(request.url, 'http://127.0.0.1:' + port);
    if (url.pathname !== '/api/test-harness') { response.writeHead(404, headers); response.end(JSON.stringify({ error: 'Unknown test route.' })); return; }
    const operation = url.searchParams.get('op');
    if (request.method === 'GET' && operation === 'manifest') {
      response.writeHead(200, headers);
      response.end(JSON.stringify({ ...sandbox.manifest, name: 'Môi trường test HTTP cục bộ' }));
      return;
    }
    if (request.method !== 'POST' || !['create-user', 'login', 'vote'].includes(operation)) { response.writeHead(405, headers); response.end(JSON.stringify({ error: 'Unsupported test operation.' })); return; }
    let text = '';
    for await (const chunk of request) { text += chunk.toString(); if (Buffer.byteLength(text) > 16384) throw new Error('Test request is too large.'); }
    const payload = JSON.parse(text);
    if (!payload || !/^run-[a-f0-9-]{36}$/.test(payload.runId)) throw new Error('Invalid test run ID.');
    if (operation === 'create-user' && (!Number.isInteger(payload.index) || payload.index < 1 || payload.index > 500)) throw new Error('Invalid simulated user index.');
    const result = operation === 'create-user' ? await sandbox.createUser(payload) : operation === 'login' ? await sandbox.login(payload) : await sandbox.vote(payload);
    response.writeHead(200, headers);
    response.end(JSON.stringify(result));
  } catch {
    response.writeHead(400, headers);
    response.end(JSON.stringify({ error: 'The simulated test operation could not be completed.' }));
  }
});
server.listen(port, '127.0.0.1', () => console.log('Test environment: http://127.0.0.1:' + port + ' · allowed dashboard: ' + allowedOrigin));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
