import test from 'node:test';
import assert from 'node:assert/strict';
import { probeStreamUpload } from '../src/lib/streamProbe.js';

const probe = (fetchImpl) => probeStreamUpload({ baseUrl: 'https://bb.example/', apiKey: 'k', fetchImpl });
const resp = (status, ct) => ({ status, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? ct : null) } });

test('probe sends a streamed POST without credentials', async () => {
  let seen;
  await probe(async (url, init) => { seen = { url, init }; return resp(405); });
  assert.equal(seen.url, 'https://bb.example/api/v1/auth/status');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.duplex, 'half');
  assert.equal(seen.init.credentials, 'omit');
  assert.equal(seen.init.headers['X-API-Key'], 'k');
  assert.ok(seen.init.body instanceof ReadableStream);
});

test('probe: 405 or 401 means ok', async () => {
  assert.equal(await probe(async () => resp(405)), 'ok');
  assert.equal(await probe(async () => resp(401, 'application/json')), 'ok');
});

test('probe: other responses (including JSON 403) mean blocked', async () => {
  assert.equal(await probe(async () => resp(403)), 'blocked');
  assert.equal(await probe(async () => resp(403, 'application/json')), 'blocked');
  assert.equal(await probe(async () => resp(502, 'text/html')), 'blocked');
});

test('probe: a timeout (AbortError) is blocked, other aborts stay unknown', async () => {
  const stall = (_u, init) => new Promise((_res, rej) => {
    init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  assert.equal(await probeStreamUpload({ baseUrl: 'https://bb.example', apiKey: 'k', fetchImpl: stall, timeoutMs: 10 }), 'blocked');
  assert.equal(await probe(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }), 'unknown');
});

test('probe: HTTP/1.1 TypeError means h1; other errors are unknown', async () => {
  assert.equal(await probe(async () => { throw new TypeError('ReadableStream uploading is only supported over HTTP/2 or HTTP/3'); }), 'h1');
  assert.equal(await probe(async () => { throw new TypeError('Failed to fetch'); }), 'unknown');
  assert.equal(await probe(async () => { throw new Error('boom'); }), 'unknown');
});
