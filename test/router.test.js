import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeChrome } from './helpers/fakeChrome.js';
import * as settings from '../src/lib/settings.js';
import { createRouter } from '../src/lib/router.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/mw-resolve.json', import.meta.url)));
const MW = 'https://makerworld.com/en/models/200000-mewtwo';
const res = (data) => ({ ok: true, status: 200, data, error: null, kind: null });
const err = (error, kind) => ({ ok: false, status: 400, data: null, error, kind });

let chrome, imports, client, router;
beforeEach(async () => {
  chrome = createFakeChrome();
  globalThis.chrome = chrome;
  await settings.setSettings({ baseUrl: 'https://bb.example/', apiKey: 'k' });
  imports = [];
  client = {
    authStatus: async () => res({ auth_enabled: true }),
    mwStatus: async () => res({ has_cloud_token: true }),
    listFolders: async () => res([{ id: 1, name: 'x', children: [] }]),
    mwResolve: async () => res(fixture),
    mwImport: async (b) => { imports.push(b); return res({ library_file_id: 9, filename: 'm.3mf', folder_id: b.folder_id ?? null, was_existing: false }); },
  };
  router = createRouter({ getClient: async () => client, settings, execInTab: null, chrome });
});

test('unknown / garbage messages', async () => {
  assert.deepEqual(await router.handle({ type: 'nope' }), { ok: false, error: 'Unknown message' });
  assert.deepEqual(await router.handle({ type: 'constructor' }), { ok: false, error: 'Unknown message' });
  assert.equal((await router.handle(undefined)).ok, false);
});

test('testConnection', async () => {
  const r = await router.handle({ type: 'testConnection' });
  assert.equal(r.ok, true);
  assert.equal(r.auth.auth_enabled, true);
  assert.equal(r.mw.has_cloud_token, true);
});

test('testConnection auth failure and unconfigured', async () => {
  client.authStatus = async () => err('bad key', 'auth');
  const r = await router.handle({ type: 'testConnection' });
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'auth');
  router = createRouter({ getClient: async () => null, settings });
  assert.equal((await router.handle({ type: 'testConnection' })).ok, false);
});

test('getPickerData makerworld', async () => {
  await settings.setSetting('lastFolderId', 1);
  const r = await router.handle({ type: 'getPickerData', url: MW });
  assert.equal(r.ok, true);
  assert.equal(r.site, 'makerworld');
  assert.equal(r.model.title, 'Mewtwo 2D');
  assert.equal(r.folders[0].name, 'x');
  assert.equal(r.lastFolderId, 1);
});

test('getPickerData other site and error', async () => {
  const r = await router.handle({ type: 'getPickerData', url: 'https://www.thingiverse.com/thing:9' });
  assert.equal(r.site, 'thingiverse');
  assert.equal(r.model, undefined);
  client.mwResolve = async () => err('nope', 'notfound');
  assert.deepEqual(await router.handle({ type: 'getPickerData', url: MW }), { ok: false, error: 'nope', kind: 'notfound' });
});

test('save: resolves default profile, persists lastFolderId, openUrl', async () => {
  const r = await router.handle({ type: 'save', url: MW, folderId: 5 });
  assert.deepEqual(imports[0], { source_type: 'makerworld', model_id: 200000, profile_id: 53897437, instance_id: 220545, folder_id: 5 });
  assert.equal(r.ok, true);
  assert.equal(r.fileId, 9);
  assert.equal(r.filename, 'm.3mf');
  assert.equal(r.folderId, 5);
  assert.equal(r.wasExisting, false);
  assert.equal(r.openUrl, 'https://bb.example/files?folder=5');
  assert.equal(await settings.getSetting('lastFolderId'), 5);
});

test('save: explicit profile skips resolve; no folder -> /files', async () => {
  client.mwResolve = async () => { throw new Error('should not resolve'); };
  const r = await router.handle({ type: 'save', url: MW, profileId: 3, folderId: null });
  assert.equal(r.ok, true);
  assert.equal(imports[0].profile_id, 3);
  assert.strictEqual(imports[0].model_id, 200000);
  assert.equal('folder_id' in imports[0], false);
  assert.equal(r.openUrl, 'https://bb.example/files');
  assert.equal(await settings.getSetting('lastFolderId'), null);
});

test('save: auth error propagates, lastFolderId untouched', async () => {
  client.mwImport = async () => err('Invalid API key', 'auth');
  await settings.setSetting('lastFolderId', 2);
  const r = await router.handle({ type: 'save', url: MW, profileId: 1, folderId: 5 });
  assert.deepEqual(r, { ok: false, error: 'Invalid API key', kind: 'auth' });
  assert.equal(await settings.getSetting('lastFolderId'), 2);
});

test('save: other site / non-model / thrown error', async () => {
  assert.deepEqual(await router.handle({ type: 'save', url: 'https://www.thingiverse.com/thing:9' }), { ok: false, error: 'Not supported yet', site: 'thingiverse' });
  assert.equal((await router.handle({ type: 'save', url: 'https://example.com' })).ok, false);
  client.mwResolve = async () => { throw new Error('boom'); };
  const r = await router.handle({ type: 'save', url: MW });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'boom');
});

// ---- Printables ----
const PR = 'https://www.printables.com/model/3161-benchy';
const prPrint = { data: { print: { id: '3161', name: 'Benchy', premium: false, user: { publicUsername: 'cr' }, image: { filePath: 'i.jpg' }, license: { name: 'CC' }, stls: [{ id: '1', name: 'b.stl', fileSize: 3 }], gcodes: [], otherFiles: [] } } };
const jsonRes = (j) => ({ ok: true, status: 200, headers: new Headers(), json: async () => j });

function prFetch(opts = {}) {
  const calls = [];
  const f = async (url, init) => {
    calls.push(url);
    if (url.includes('graphql')) {
      const q = JSON.parse(init.body).query;
      if (q.startsWith('query')) return jsonRes(opts.print || prPrint);
      return jsonRes({ data: { getDownloadLink: { ok: true, output: { link: 'https://files.printables.com/b.stl' } } } });
    }
    if (url === 'https://files.printables.com/b.stl') {
      const headers = new Headers(opts.bytes ? { 'content-length': String(opts.bytes) } : {});
      return { ok: true, status: 200, headers, body: new Response(new Uint8Array([1, 2, 3])).body };
    }
    return { ok: true, status: 200, headers: new Headers(), blob: async () => new Blob([new Uint8Array(2)], { type: 'image/jpeg' }) };
  };
  f.calls = calls;
  return f;
}

function prClient() {
  const c = {
    ...client,
    uploads: [],
    uploadFile: async (blob, name, o) => { c.uploads.push({ name, o }); return res({ id: 42 }); },
    updateFile: async () => res({}),
    setThumbnail: async () => res({}),
    listTags: async () => res([]),
    createTag: async () => res({ id: 1 }),
    bulkAssignTags: async () => res({}),
  };
  return c;
}

test('getPickerData printables', async () => {
  const f = prFetch();
  router = createRouter({ getClient: async () => client, settings, fetchImpl: f });
  const r = await router.handle({ type: 'getPickerData', url: PR });
  assert.equal(r.ok, true);
  assert.equal(r.site, 'printables');
  assert.deepEqual(r.model, { title: 'Benchy', designer: 'cr', thumbnail: 'https://media.printables.com/i.jpg', files: ['b.stl'], premium: false });
  assert.equal(r.folders[0].name, 'x');
});

test('save printables: pipeline, lastFolderId, diagnostics, progress', async () => {
  const f = prFetch();
  const c = prClient();
  const prog = [];
  await settings.setSettings({ uploadMode: 'buffer' });
  router = createRouter({ getClient: async () => c, settings, fetchImpl: f, onProgress: (p) => prog.push(p) });
  const r = await router.handle({ type: 'save', url: PR, folderId: 5 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.fileIds, [42]);
  assert.equal(c.uploads[0].name, 'b.stl');
  assert.equal(c.uploads[0].o.folderId, 5);
  assert.equal(r.openUrl, 'https://bb.example/files?folder=5');
  assert.equal(await settings.getSetting('lastFolderId'), 5);
  const d = (await settings.getSetting('diagnostics')).printables;
  assert.equal(d.strategy, 'graphql');
  assert.equal(d.error, undefined);
  assert.ok(prog.length > 0);
});

test('save printables: needsConfirmLarge round-trip', async () => {
  const f = prFetch({ bytes: 300 * 1024 * 1024 });
  const c = prClient();
  await settings.setSettings({ uploadMode: 'buffer' });
  router = createRouter({ getClient: async () => c, settings, fetchImpl: f });
  const r1 = await router.handle({ type: 'save', url: PR, folderId: null });
  assert.equal(r1.ok, false);
  assert.equal(r1.needsConfirmLarge.filename, 'b.stl');
  assert.equal(r1.needsConfirmLarge.bytes, 300 * 1024 * 1024);
  assert.equal(c.uploads.length, 0);
  const r2 = await router.handle({ type: 'save', url: PR, folderId: null, confirmLarge: true });
  assert.equal(r2.needsConfirmLarge, undefined);
  assert.equal(c.uploads.length, 1);
  assert.equal(r2.ok, true);
});

test('save printables: premium and no compatible files record error', async () => {
  router = createRouter({ getClient: async () => prClient(), settings, fetchImpl: prFetch({ print: { data: { print: { ...prPrint.data.print, premium: true } } } }) });
  const r = await router.handle({ type: 'save', url: PR });
  assert.equal(r.ok, false);
  assert.match(r.error, /paid model/);
  assert.match((await settings.getSetting('diagnostics')).printables.error, /paid/);
  router = createRouter({ getClient: async () => prClient(), settings, fetchImpl: prFetch({ print: { data: { print: { ...prPrint.data.print, stls: [] } } } }) });
  assert.match((await router.handle({ type: 'save', url: PR })).error, /No Bambuddy-compatible files/);
});

test('save printables: auto -> buffer persisted via setUploadMode', async () => {
  const c = prClient();
  c.uploadFileStream = async () => ({ ok: false, error: 'h1', streamUnsupported: true });
  router = createRouter({ getClient: async () => c, settings, fetchImpl: prFetch() });
  const r = await router.handle({ type: 'save', url: PR });
  assert.equal(r.ok, true);
  assert.equal(await settings.getSetting('uploadMode'), 'buffer');
});
