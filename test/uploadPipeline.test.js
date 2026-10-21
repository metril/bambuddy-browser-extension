import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runUploadPipeline } from '../src/lib/uploadPipeline.js';
import { makeResponse } from './helpers/fakeFetch.js';

const okR = (data) => ({ ok: true, status: 200, data, error: null, kind: null });
const bodyOf = (...chunks) => new ReadableStream({
  start(c) { for (const x of chunks) c.enqueue(new Uint8Array(x)); c.close(); },
});
async function drain(stream) {
  const parts = [];
  for await (const c of stream) parts.push(Buffer.from(c));
  return Buffer.concat(parts);
}

function setup({ sources = {}, client: over = {} } = {}) {
  const fetched = [];
  const fetchImpl = async (url, init) => {
    fetched.push({ url, init });
    const s = sources[url];
    if (!s) return makeResponse({ status: 404 });
    const spec = typeof s === 'function' ? s() : s;
    const chunks = spec.chunks || [[1, 2], [3], [4, 5]];
    const res = makeResponse({ body: bodyOf(...chunks), headers: spec.headers || {}, status: spec.status || 200 });
    res.blob = async () => new Blob(chunks.map((c) => new Uint8Array(c)), { type: 'image/png' });
    return res;
  };
  const calls = [];
  let n = 0;
  const rec = (name, impl) => async (...a) => { calls.push([name, ...a]); return impl(...a); };
  const client = {
    uploadFile: rec('uploadFile', async () => okR({ id: ++n })),
    uploadFileStream: rec('uploadFileStream', async (parts) => { await drain(parts.stream); return okR({ id: ++n }); }),
    extractZip: rec('extractZip', async () => okR({ files: [{ filename: 'a.stl', file_id: 90 }, { filename: 'r.txt', file_id: 91 }], errors: [{ filename: 'bad', error: 'x' }] })),
    extractZipStream: rec('extractZipStream', async (parts) => { await drain(parts.stream); return okR({ files: [{ filename: 'a.stl', file_id: 90 }], errors: [] }); }),
    updateFile: rec('updateFile', async () => okR({})),
    setThumbnail: rec('setThumbnail', async () => okR({})),
    listTags: rec('listTags', async () => okR([])),
    createTag: rec('createTag', async () => okR({ id: 7, name: 'Printables' })),
    bulkAssignTags: rec('bulkAssignTags', async () => okR({})),
    ...over,
  };
  const progress = [];
  const hooks = { onProgress: (p) => progress.push(p), setUploadMode: (m) => calls.push(['setUploadMode', m]) };
  const base = {
    client, hooks, folderId: 3,
    meta: { title: 'T', designer: 'D', site: 'printables', pageUrl: 'https://p/x' },
    options: { uploadMode: 'auto', maxFileMB: 1, tagUploads: false, fetchImpl, credentials: 'include' },
  };
  return { base, calls, fetched, progress, client, hooks };
}
const names = (calls) => calls.map((c) => c[0]);

test('stream mode uploads, reports progress, applies metadata', async () => {
  const { base, calls, progress, fetched } = setup({ sources: { 'u/a': {} } });
  const r = await runUploadPipeline({ ...base, files: [{ url: 'u/a', filename: 'a.3mf' }] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.fileIds, [1]);
  assert.equal(r.results[0].mode, 'stream');
  assert.deepEqual(names(calls), ['uploadFileStream', 'updateFile']);
  assert.equal(fetched[0].init.credentials, 'include');
  const ups = progress.filter((p) => p.phase === 'upload');
  assert.equal(ups.at(-1).bytes, 5);
  const upd = calls.find((c) => c[0] === 'updateFile');
  assert.equal(upd[1], 1);
  assert.match(upd[2].notes, /^T by D — imported from Printables\nhttps:\/\/p\/x$/);
  assert.equal(upd[2].external_url, 'https://p/x');
});

test('streamUnsupported flips to buffer, re-fetches once, later files go to buffer', async () => {
  const { base, calls, fetched } = setup({
    sources: { 'u/a': {}, 'u/b': {} },
    client: { uploadFileStream: async () => ({ ok: false, status: 0, error: 'h1', kind: 'network', streamUnsupported: true }) },
  });
  const r = await runUploadPipeline({ ...base, files: [{ url: 'u/a', filename: 'a.stl' }, { url: 'u/b', filename: 'b.stl' }] });
  assert.equal(r.ok, true);
  assert.deepEqual(fetched.map((f) => f.url), ['u/a', 'u/a', 'u/b']);
  assert.deepEqual(names(calls).filter((n) => n === 'setUploadMode' || n === 'uploadFile'), ['setUploadMode', 'uploadFile', 'uploadFile']);
  assert.deepEqual(r.results.map((x) => x.mode), ['buffer', 'buffer']);
  const blob = calls.find((c) => c[0] === 'uploadFile')[1];
  assert.equal(blob.size, 5);
});

test('buffer mode uploads a Blob', async () => {
  const { base, calls } = setup({ sources: { 'u/a': {} } });
  base.options.uploadMode = 'buffer';
  const r = await runUploadPipeline({ ...base, files: [{ url: 'u/a', filename: 'a.stl' }] });
  assert.equal(r.ok, true);
  assert.deepEqual(names(calls), ['uploadFile', 'updateFile']);
});

test('buffer mode aborts unknown-size body over limit', async () => {
  const big = [new Array(700 * 1024).fill(1), new Array(700 * 1024).fill(1)];
  const { base } = setup({ sources: { 'u/a': { chunks: big } } });
  base.options.uploadMode = 'buffer';
  const r = await runUploadPipeline({ ...base, files: [{ url: 'u/a', filename: 'a.stl' }] });
  assert.equal(r.ok, false);
  assert.match(r.results[0].error, /exceeds/);
});

test('unsupported file is skipped with warning; ok stays true', async () => {
  const { base, fetched } = setup();
  const r = await runUploadPipeline({ ...base, files: [{ url: 'u/a', filename: 'a.gcode' }] });
  assert.equal(r.ok, true);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.warnings.length, 1);
  assert.equal(fetched.length, 0);
});

test('confirmLarge false skips; true uploads', async () => {
  const headers = { 'content-length': String(5 * 1024 * 1024) };
  const s1 = setup({ sources: { 'u/a': { headers } } });
  s1.hooks.confirmLarge = async () => false;
  const r1 = await runUploadPipeline({ ...s1.base, files: [{ url: 'u/a', filename: 'a.stl' }] });
  assert.equal(r1.ok, true);
  assert.equal(r1.skipped[0].reason, 'too-large');
  assert.equal(s1.calls.length, 0);
  const s2 = setup({ sources: { 'u/a': { headers } } });
  s2.hooks.confirmLarge = async () => true;
  const r2 = await runUploadPipeline({ ...s2.base, files: [{ url: 'u/a', filename: 'a.stl' }] });
  assert.deepEqual(r2.fileIds, [1]);
});

test('upload failure => ok:false; download failure too; meta/thumb failures only warn', async () => {
  const s = setup({
    sources: { 'u/a': {}, 'u/c': {}, 'th': { chunks: [[9]] } },
    client: {
      updateFile: async () => ({ ok: false, error: 'nope' }),
      setThumbnail: async () => ({ ok: false, error: 'bad thumb' }),
    },
  });
  s.base.meta.thumbnailUrl = 'th';
  const r = await runUploadPipeline({ ...s.base, files: [{ url: 'u/a', filename: 'a.stl' }, { url: 'missing', filename: 'b.stl' }] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.fileIds, [1]);
  assert.equal(r.results[1].ok, false);
  assert.equal(r.warnings.length, 2);
  const f = s.fetched.find((x) => x.url === 'th');
  assert.equal(f.init.credentials, 'omit');

  const s2 = setup({ sources: { 'u/a': {} }, client: { uploadFileStream: async () => ({ ok: false, status: 500, error: 'boom', kind: 'server' }) } });
  const r2 = await runUploadPipeline({ ...s2.base, files: [{ url: 'u/a', filename: 'a.stl' }] });
  assert.equal(r2.ok, false);
  assert.equal(r2.results[0].error, 'boom');
});

test('thumbnail only for first file; zip uses extractZipStream with create_folder', async () => {
  const s = setup({ sources: { 'u/z': {}, 'u/b': {}, th: { chunks: [[9]] } } });
  s.base.meta.thumbnailUrl = 'th';
  const r = await runUploadPipeline({ ...s.base, files: [{ url: 'u/z', filename: 'm.zip' }, { url: 'u/b', filename: 'b.stl' }] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.fileIds, [90, 1]);
  const z = s.calls.find((c) => c[0] === 'extractZipStream');
  assert.deepEqual(z[2], { folderId: 3, createFolderFromZip: true });
  assert.equal(s.calls.filter((c) => c[0] === 'setThumbnail').length, 1);
  assert.equal(s.calls.find((c) => c[0] === 'setThumbnail')[1], 90);
});

test('zip in buffer mode uses extractZip; only 3mf/stl get meta; errors warn; empty fails', async () => {
  const s = setup({ sources: { 'u/z': {} } });
  s.base.options.uploadMode = 'buffer';
  const r = await runUploadPipeline({ ...s.base, files: [{ url: 'u/z', filename: 'm.zip' }] });
  assert.deepEqual(r.fileIds, [90]);
  assert.ok(r.warnings.some((w) => w.includes('bad')));
  const s2 = setup({ sources: { 'u/z': {} }, client: { extractZip: async () => okR({ files: [], errors: [] }) } });
  s2.base.options.uploadMode = 'buffer';
  const r2 = await runUploadPipeline({ ...s2.base, files: [{ url: 'u/z', filename: 'm.zip' }] });
  assert.equal(r2.ok, false);
});

test('tag created once per run and cached; existing tag reused', async () => {
  const s = setup({ sources: { 'u/a': {}, 'u/b': {} } });
  s.base.options.tagUploads = true;
  await runUploadPipeline({ ...s.base, files: [{ url: 'u/a', filename: 'a.stl' }, { url: 'u/b', filename: 'b.stl' }] });
  assert.equal(s.calls.filter((c) => c[0] === 'createTag').length, 1);
  assert.equal(s.calls.filter((c) => c[0] === 'listTags').length, 1);
  assert.deepEqual(s.calls.filter((c) => c[0] === 'bulkAssignTags').map((c) => c.slice(1)), [[[1], [7]], [[2], [7]]]);
  const s2 = setup({ sources: { 'u/a': {} }, client: { listTags: async () => okR([{ id: 4, name: 'printables' }]) } });
  s2.base.options.tagUploads = true;
  await runUploadPipeline({ ...s2.base, files: [{ url: 'u/a', filename: 'a.stl' }] });
  assert.equal(s2.calls.some((c) => c[0] === 'createTag'), false);
  assert.deepEqual(s2.calls.find((c) => c[0] === 'bulkAssignTags').slice(1), [[1], [4]]);
});

test('duplicate_of surfaced', async () => {
  const s = setup({ sources: { 'u/a': {} }, client: { uploadFileStream: async () => okR({ id: 5, duplicate_of: 2 }) } });
  const r = await runUploadPipeline({ ...s.base, files: [{ url: 'u/a', filename: 'a.stl' }] });
  assert.equal(r.results[0].duplicateOf, 2);
});

test('failed stream send aborts the first source before the re-fetch', async () => {
  const s = setup({
    sources: { 'u/a': {} },
    client: { uploadFileStream: async () => ({ ok: false, status: 0, error: 'h1', kind: 'network', streamUnsupported: true }) },
  });
  const events = [];
  const inner = s.base.options.fetchImpl;
  s.base.options.fetchImpl = async (url, init) => {
    const n = events.filter((e) => e.startsWith('fetch')).length;
    events.push(`fetch${n}`);
    init.signal.addEventListener('abort', () => events.push(`abort${n}`));
    return inner(url, init);
  };
  const r = await runUploadPipeline({ ...s.base, files: [{ url: 'u/a', filename: 'a.stl' }] });
  assert.equal(r.ok, true);
  assert.deepEqual(events, ['fetch0', 'abort0', 'fetch1']);
});

test('stream progress carries total; filenames are sanitized', async () => {
  const s = setup({ sources: { 'u/a': { headers: { 'content-length': '5' } } } });
  const r = await runUploadPipeline({ ...s.base, files: [{ url: 'u/a', filename: 'a:b.stl' }] });
  assert.equal(r.results[0].filename, 'a_b.stl');
  assert.equal(s.progress.filter((p) => p.phase === 'upload').at(-1).total, 5);
});
