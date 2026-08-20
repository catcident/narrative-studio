import test from 'node:test';
import assert from 'node:assert/strict';

const baseUrl = process.env.TEST_AI_OFF_BASE_URL || 'http://127.0.0.1:3301';

const disabledRequests = [
  { path: '/api/models', method: 'GET' },
  { path: '/api/analyze', method: 'POST' },
  { path: '/api/chat', method: 'POST' },
  { path: '/api/embeddings', method: 'POST' },
  { path: '/api/embeddings', method: 'GET' },
  { path: '/api/chunk-embeddings', method: 'POST' },
  { path: '/api/chunk-embeddings', method: 'GET' },
  { path: '/api/validate-key', method: 'POST' },
];

test('AI kill switch fails closed before request parsing or provider access', async () => {
  const configResponse = await fetch(`${baseUrl}/api/config`);
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.equal(config.aiEnabled, false);
  assert.equal(config.hasEnvKey, false);
  assert.equal(config.serviceReady, true);

  for (const request of disabledRequests) {
    const response = await fetch(`${baseUrl}${request.path}`, {
      method: request.method,
      headers: request.method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: request.method === 'POST' ? '{' : undefined,
    });
    assert.equal(response.status, 404, `${request.method} ${request.path}`);
    assert.equal((await response.json()).error_code, 'ai_disabled');
  }
});
