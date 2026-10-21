import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/lib/api.js';
import { createFakeFetch } from './helpers/fakeFetch.js';

const KEY = 'bb_testkey_not_real';
const mk = (queue, opts = {}) => {
  const f = createFakeFetch(queue);
  return { f, c: createClient({ baseUrl: 'https://bb.test', apiKey: KEY, fetchImpl: f, ...opts }) };
};

test('GET sets headers, no content-type, credentials omit, skips null query', async () => {
  const { f, c } = mk([{ json: { a: 1 } }]);
  const r = await c.request('GET', '/x', { query: { a: 1, b: undefined, c: null, d: 'x y' } });
  assert.deepEqual(r, { ok: true, status: 200, data: { a: 1 }, error: null, kind: null });
  const { url, init } = f.calls[0];
  assert.equal(url, 'https://bb.test/api/v1/x?a=1&d=x+y');
  assert.equal(init.headers['X-API-Key'], KEY);
  assert.equal(init.headers.Accept, 'application/json');
  assert.equal(init.headers['Content-Type'], undefined);
  assert.equal(init.credentials, 'omit');
});

test('JSON body sets content-type', async () => {
  const { f, c } = mk([{ json: {} }]);
  await c.request('POST', '/x', { body: { a: 1 } });
  assert.equal(f.calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(f.calls[0].init.body, '{"a":1}');
});

test('multipart upload uses FormData and no manual content-type', async () => {
  const { f, c } = mk([{ json: { id: 1 } }]);
  const r = await c.uploadFile(new Blob(['abc']), 'a.stl', { folderId: 5, generateStlThumbnails: true });
  assert.equal(r.ok, true);
  const { url, init } = f.calls[0];
  assert.equal(url, 'https://bb.test/api/v1/library/files?folder_id=5&generate_stl_thumbnails=true');
  assert.ok(init.body instanceof FormData);
  assert.equal(init.body.get('file').name, 'a.stl');
  assert.equal(init.headers['Content-Type'], undefined);
});

test('kind mapping', async () => {
  const cases = [[401, 'auth'], [403, 'auth'], [404, 'notfound'], [422, 'client'], [409, 'client'], [500, 'server'], [503, 'server']];
  for (const [status, kind] of cases) {
    const { c } = mk([{ status, json: { detail: 'nope' } }]);
    const r = await c.request('GET', '/x');
    assert.equal(r.ok, false);
    assert.equal(r.kind, kind);
    assert.equal(r.status, status);
    assert.equal(r.error, 'nope');
  }
});

test('network error and timeout map to kind network', async () => {
  let { c } = mk([new TypeError('boom')]);
  let r = await c.request('GET', '/x');
  assert.deepEqual([r.ok, r.status, r.kind, r.error], [false, 0, 'network', 'boom']);

  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
  ({ c } = mk([hang], { timeoutMs: 20 }));
  r = await c.request('GET', '/x');
  assert.deepEqual([r.ok, r.status, r.kind, r.error], [false, 0, 'network', 'Timed out']);
  assert.equal(r.timedOut, true);
  ({ c } = mk([new TypeError('boom')]));
  assert.equal((await c.request('GET', '/x')).timedOut, undefined);
});

test('mwImport uses the upload timeout, not the short one', async () => {
  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
  let { c } = mk([hang], { timeoutMs: 10, uploadTimeoutMs: 40 });
  const t0 = Date.now();
  const r = await c.mwImport({ model_id: 1 });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - t0 >= 30);
});

test('caller abort signal cancels', async () => {
  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
  const { c } = mk([hang]);
  const ac = new AbortController();
  const p = c.request('GET', '/x', { signal: ac.signal });
  ac.abort();
  const r = await p;
  assert.equal(r.kind, 'network');
});

test('detail array joined with "; "', async () => {
  const { c } = mk([{ status: 422, json: { detail: [{ msg: 'a bad' }, { msg: 'b bad' }] } }]);
  assert.equal((await c.request('POST', '/x', { body: {} })).error, 'a bad; b bad');
});

test('falls back to statusText', async () => {
  const { c } = mk([() => ({ ok: false, status: 502, statusText: 'Bad Gateway', async text() { return '<html>'; } })]);
  assert.equal((await c.request('GET', '/x')).error, 'Bad Gateway');
});

test('API key never appears in error strings', async () => {
  let { c } = mk([{ status: 401, json: { detail: `Invalid key ${KEY}` } }]);
  let r = await c.request('GET', '/x');
  assert.ok(!r.error.includes(KEY));
  ({ c } = mk([new Error(`failed with ${KEY}`)]));
  r = await c.request('GET', '/x');
  assert.ok(!r.error.includes(KEY));
});

test('uploadStream passes duplex half and multipart content-type', async () => {
  const { f, c } = mk([{ json: { id: 2 } }]);
  const stream = new ReadableStream();
  const r = await c.uploadFileStream({ stream, boundary: 'BND' }, { folderId: 9 });
  assert.equal(r.ok, true);
  const { url, init } = f.calls[0];
  assert.equal(url, 'https://bb.test/api/v1/library/files?folder_id=9');
  assert.equal(init.duplex, 'half');
  assert.equal(init.body, stream);
  assert.equal(init.headers['Content-Type'], 'multipart/form-data; boundary=BND');
});

test('uploadStream flags streamUnsupported on stream TypeError', async () => {
  for (const msg of ['ReadableStream uploading is only supported over HTTP/2 or HTTP/3']) {
    const { c } = mk([new TypeError(msg)]);
    const r = await c.uploadStream('/library/files', { stream: new ReadableStream(), boundary: 'B' });
    assert.equal(r.ok, false);
    assert.equal(r.kind, 'network');
    assert.equal(r.status, 0);
    assert.equal(r.streamUnsupported, true);
    assert.equal(r.error, msg);
  }
  let { c } = mk([new TypeError('Failed to fetch')]);
  assert.equal((await c.uploadStream('/x', { stream: new ReadableStream(), boundary: 'B' })).streamUnsupported, undefined);
  ({ c } = mk([new Error('other')]));
  const r = await c.uploadStream('/x', { stream: new ReadableStream(), boundary: 'B' });
  assert.equal(r.streamUnsupported, undefined);
});

test('typed helpers hit the right routes', async () => {
  const { f, c } = mk(Array.from({ length: 12 }, () => ({ json: {} })));
  await c.authStatus();
  await c.mwStatus();
  await c.mwResolve('https://makerworld.com/en/models/1');
  await c.mwImport({ model_id: 1, profile_id: 2, folder_id: 3 });
  await c.mwRecent(5);
  await c.updateFile(7, { notes: 'n' });
  await c.setThumbnail(7, new Blob(['x']), 't.png');
  await c.listFolders();
  await c.createFolder('f', 1);
  await c.listTags();
  await c.createTag('t');
  await c.bulkAssignTags([1], [2]);
  const got = f.calls.map((x) => `${x.init.method} ${x.url.replace('https://bb.test/api/v1', '')}`);
  assert.deepEqual(got, [
    'GET /auth/status', 'GET /makerworld/status', 'POST /makerworld/resolve', 'POST /makerworld/import',
    'GET /makerworld/recent-imports?limit=5', 'PUT /library/files/7', 'POST /library/files/7/preview-thumbnail',
    'GET /library/folders', 'POST /library/folders', 'GET /library/tags', 'POST /library/tags',
    'POST /library/tags/bulk-assign',
  ]);
  assert.deepEqual(JSON.parse(f.calls[3].init.body), { source_type: 'makerworld', model_id: 1, profile_id: 2, folder_id: 3 });
  assert.equal(f.calls[6].init.body.get('thumbnail').name, 't.png');
  assert.deepEqual(JSON.parse(f.calls[8].init.body), { name: 'f', parent_id: 1 });
  assert.deepEqual(JSON.parse(f.calls[11].init.body), { file_ids: [1], tag_ids: [2], action: 'add' });
});

test('extractZip is multipart with zip query params', async () => {
  const { f, c } = mk([{ json: {} }, { json: {} }]);
  await c.extractZip(new Blob(['z']), 'a.zip', { folderId: 2 });
  const { url, init } = f.calls[0];
  assert.equal(url, 'https://bb.test/api/v1/library/files/extract-zip?folder_id=2&preserve_structure=true&create_folder_from_zip=false&generate_stl_thumbnails=true');
  assert.equal(init.body.get('file').name, 'a.zip');
  assert.equal(init.headers['Content-Type'], undefined);
  await c.extractZip(new Blob(['z']), 'a.zip', { createFolderFromZip: true, preserveStructure: false, generateStlThumbnails: false });
  assert.equal(f.calls[1].url, 'https://bb.test/api/v1/library/files/extract-zip?preserve_structure=false&create_folder_from_zip=true&generate_stl_thumbnails=false');
});

test('extractZipStream streams with duplex half', async () => {
  const { f, c } = mk([{ json: {} }]);
  await c.extractZipStream({ stream: new ReadableStream(), boundary: 'B' }, { folderId: 4 });
  assert.equal(f.calls[0].url, 'https://bb.test/api/v1/library/files/extract-zip?folder_id=4&preserve_structure=true&create_folder_from_zip=false&generate_stl_thumbnails=true');
  assert.equal(f.calls[0].init.duplex, 'half');
});

test('no X-API-Key header when key unset', async () => {
  const f = createFakeFetch([{ json: {} }]);
  await createClient({ baseUrl: 'https://bb.test', fetchImpl: f }).request('GET', '/x');
  assert.equal('X-API-Key' in f.calls[0].init.headers, false);
});
