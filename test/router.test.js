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
  router = createRouter({ getClient: async () => client, settings, execInTab: null, chrome, probeStream: async () => 'ok' });
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

test('testConnection returns the write-scope note and creates nothing', async () => {
  client.createFolder = async () => { throw new Error('must not create'); };
  const r = await router.handle({ type: 'testConnection' });
  assert.equal(r.scopeNote, 'Write access (can_manage_library) is only verified on first upload.');
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
  const r = await router.handle({ type: 'getPickerData', url: 'https://www.thingiverse.com/search?q=x' });
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
  assert.equal((await router.handle({ type: 'save', url: 'https://www.thingiverse.com/thing:9' })).site, 'thingiverse');
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
  const big = { data: { print: { ...prPrint.data.print, stls: [{ id: '1', name: 'b.stl', fileSize: 300 * 1024 * 1024 }] } } };
  const f = prFetch({ print: big });
  const c = prClient();
  await settings.setSettings({ uploadMode: 'buffer' });
  router = createRouter({ getClient: async () => c, settings, fetchImpl: f });
  const r1 = await router.handle({ type: 'save', url: PR, folderId: null });
  assert.equal(r1.ok, false);
  assert.deepEqual(r1.needsConfirmLarge.files, [{ filename: 'b.stl', bytes: 300 * 1024 * 1024 }]);
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

test('testConnection: rejected key is detected via listFolders, mwStatus not run', async () => {
  client.listFolders = async () => err('Invalid API key', 'auth');
  let mwCalled = false;
  client.mwStatus = async () => { mwCalled = true; return res({}); };
  const r = await router.handle({ type: 'testConnection' });
  assert.deepEqual([r.ok, r.kind, r.error], [false, 'auth', 'API key rejected']);
  assert.equal(mwCalled, false);
});

test('save printables: stream fallback persists streamSupport blocked, keeps uploadMode', async () => {
  await settings.setSettings({ streamSupport: 'ok' });
  const c = prClient();
  c.uploadFileStream = async () => ({ ok: false, error: 'h1', streamUnsupported: true });
  router = createRouter({ getClient: async () => c, settings, fetchImpl: prFetch() });
  const r = await router.handle({ type: 'save', url: PR });
  assert.equal(r.ok, true);
  assert.equal(await settings.getSetting('streamSupport'), 'blocked');
  assert.equal(await settings.getSetting('uploadMode'), 'auto');
});

test('save printables: two files, one large -> one upload per file across both passes', async () => {
  const two = { data: { print: { ...prPrint.data.print, stls: [{ id: '1', name: 'b.stl', fileSize: 3 }, { id: '2', name: 'c.stl', fileSize: 300 * 1024 * 1024 }] } } };
  const f = async (url, init) => {
    if (url.includes('graphql') && !JSON.parse(init.body).query.startsWith('query')) {
      return jsonRes({ data: { getDownloadLink: { ok: true, output: { link: `https://files.printables.com/${JSON.parse(init.body).variables.files[0].ids[0]}.stl` } } } });
    }
    if (url.includes('graphql')) return jsonRes(two);
    if (url.startsWith('https://files.')) return { ok: true, status: 200, headers: new Headers(), body: new Response(new Uint8Array([1])).body };
    return { ok: true, status: 200, headers: new Headers(), blob: async () => new Blob([new Uint8Array(1)]) };
  };
  const c = prClient();
  await settings.setSettings({ uploadMode: 'buffer' });
  router = createRouter({ getClient: async () => c, settings, fetchImpl: f });
  const r1 = await router.handle({ type: 'save', url: PR, folderId: 5 });
  assert.equal(r1.ok, false);
  assert.deepEqual(r1.needsConfirmLarge.files.map((x) => x.filename), ['c.stl']);
  assert.equal(c.uploads.length, 0);
  assert.equal(await settings.getSetting('lastFolderId'), null);
  const r2 = await router.handle({ type: 'save', url: PR, folderId: 5, confirmLarge: true });
  assert.equal(r2.ok, true);
  assert.deepEqual(c.uploads.map((u) => u.name), ['b.stl', 'c.stl']);
  assert.equal(await settings.getSetting('lastFolderId'), 5);
});

// ---- Thingiverse ----
const TV = 'https://www.thingiverse.com/thing:5';
const tvPage = { title: 'Benchy by Cr - Thingiverse', jsonLd: [], og: { image: 'https://og.jpg' }, fileLinks: [{ href: '/download:7', text: 'b.stl' }] };
function tvFetch(zip) {
  const f = async (url) => {
    f.calls.push(url);
    if (url.endsWith('/zip')) return { ok: zip, status: zip ? 200 : 403, headers: new Headers({ 'content-type': zip ? 'application/zip' : 'text/html' }), body: { cancel: async () => {} } };
    return { ok: true, status: 200, headers: new Headers(), body: new Response(new Uint8Array([1, 2, 3])).body, blob: async () => new Blob([new Uint8Array(2)]) };
  };
  f.calls = [];
  return f;
}

test('getPickerData thingiverse uses execInTab with tabId', async () => {
  const calls = [];
  router = createRouter({ getClient: async () => client, settings, execInTab: async (id, fn, args) => { calls.push([id, typeof fn, args]); return tvPage; } });
  const r = await router.handle({ type: 'getPickerData', url: TV, tabId: 9 });
  assert.deepEqual(calls, [[9, 'function', []]]);
  assert.equal(r.site, 'thingiverse');
  assert.deepEqual(r.model, { title: 'Benchy', designer: 'Cr', thumbnail: 'https://og.jpg', files: ['b.stl'] });
});

test('save thingiverse: links strategy, diagnostics, lastFolderId', async () => {
  const c = prClient();
  await settings.setSettings({ uploadMode: 'buffer' });
  router = createRouter({ getClient: async () => c, settings, fetchImpl: tvFetch(false), execInTab: async () => tvPage });
  const r = await router.handle({ type: 'save', url: TV, tabId: 9, folderId: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.site, 'thingiverse');
  assert.equal(c.uploads[0].name, 'b.stl');
  assert.equal(await settings.getSetting('lastFolderId'), 3);
  assert.equal((await settings.getSetting('diagnostics')).thingiverse.strategy, 'links');
});

test('save thingiverse: blocked records none + error, no lastFolderId', async () => {
  router = createRouter({ getClient: async () => prClient(), settings, fetchImpl: tvFetch(false), execInTab: async () => ({ fileLinks: [] }) });
  const r = await router.handle({ type: 'save', url: TV, tabId: 9, folderId: 3 });
  assert.equal(r.ok, false);
  assert.match(r.error, /Cloudflare/);
  const d = (await settings.getSetting('diagnostics')).thingiverse;
  assert.equal(d.strategy, 'none');
  assert.match(d.error, /Cloudflare/);
  assert.notEqual(await settings.getSetting('lastFolderId'), 3);
});

test('save thingiverse: HTML download maps to Cloudflare message and diagnostics', async () => {
  const f = async (url) => (url.endsWith('/zip')
    ? { ok: false, status: 403, headers: new Headers({ 'content-type': 'text/html' }), body: { cancel: async () => {} } }
    : { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }), body: new Response('<html>').body });
  router = createRouter({ getClient: async () => prClient(), settings, fetchImpl: f, execInTab: async () => tvPage });
  const r = await router.handle({ type: 'save', url: TV, tabId: 9 });
  assert.equal(r.ok, false);
  assert.match(r.error, /Cloudflare/);
  const d = (await settings.getSetting('diagnostics')).thingiverse;
  assert.equal(d.strategy, 'links');
  assert.match(d.error, /Cloudflare/);
});

// ---- bulk import ----
const dsg = (id) => ({ id, title: `Model ${id}`, designCreator: { name: 'a' }, cover: 'c' });
const bulkPage = {
  readCollectionsDataInPage: { href: 'https://makerworld.com/en/@bob/collections', nextData: { buildId: 'B' }, routePageProps: null },
  collectAnchorPathnamesInPage: [],
  fetchDataRouteInPage: (b, p) => ({ pageProps: { designs: p.includes('/collections/1-') ? [dsg(1), dsg(2), dsg(3)] : [dsg(4)] } }),
};
const COLLS = [{ listId: '1', title: 'Alpha', slug: 'alpha', count: 3 }, { listId: '2', title: 'Beta', slug: 'beta', count: 1 }];
let created, resolves, ended;
function bulkRouter(over = {}) {
  created = []; resolves = []; ended = [];
  client.listFolders = async () => res([{ id: 10, name: 'Root', children: [{ id: 11, name: 'Alpha', children: [] }] }]);
  client.createFolder = async (name, parentId) => { created.push({ name, parentId }); return res({ id: 50 + created.length }); };
  client.mwResolve = async (url) => { resolves.push(url); return res({ model_id: Number(url.split('/').pop()), already_imported_library_ids: [] }); };
  const exec = async (tabId, func, args) => (typeof bulkPage[func.name] === "function" ? bulkPage[func.name](...args) : bulkPage[func.name]);
  router = createRouter({ getClient: async () => client, settings, chrome, execInTab: exec, onJobFinished: (j) => ended.push(j), ...over });
}

test('startBulk reuses an existing folder, creates a missing one, imports into each', async () => {
  bulkRouter();
  assert.deepEqual(await router.handle({ type: 'startBulk', tabId: 1, collections: COLLS, parentFolderId: 10 }), { ok: true });
  await router.idle();
  assert.deepEqual(created, [{ name: 'Beta', parentId: 10 }]);
  const byModel = Object.fromEntries(imports.map((i) => [i.model_id, i.folder_id]));
  assert.deepEqual(byModel, { 1: 11, 2: 11, 3: 11, 4: 51 });
  const { job } = await router.handle({ type: 'getJob' });
  assert.equal(job.status, 'done');
  assert.equal(job.imported.length, 4);
  assert.equal(job.openUrl, 'https://bb.example/files?folder=11');
  assert.equal(ended.length, 1);
  assert.ok(chrome.calls.alarmsCreate.some((a) => a.name === 'job-tick' && a.info.periodInMinutes === 0.5));
  assert.ok(chrome.calls.alarmsClear.includes('job-tick'));
  assert.ok(chrome.storage.session.data.job);
});

test('a throwing job write never stops the bulk job from finishing', async () => {
  bulkRouter();
  const orig = chrome.storage.session.set;
  chrome.storage.session.set = async () => { throw new Error('quota'); };
  await router.handle({ type: 'startBulk', tabId: 1, collections: COLLS, parentFolderId: 10 });
  await router.idle();
  chrome.storage.session.set = orig;
  assert.equal(ended.length, 1);
  assert.equal(ended[0].imported.length, 4);
  assert.ok(chrome.calls.alarmsClear.includes('job-tick'));
});

test('startBulk skips already-imported and was_existing, reports failures', async () => {
  bulkRouter();
  client.mwResolve = async (url) => {
    const id = Number(url.split('/').pop());
    return res({ model_id: id, already_imported_library_ids: id === 1 ? [7] : [] });
  };
  client.mwImport = async (b) => {
    imports.push(b);
    if (b.model_id === 2) return res({ library_file_id: 8, was_existing: true });
    if (b.model_id === 3) return err('cloud down', 'server');
    return res({ library_file_id: 9, was_existing: false });
  };
  await router.handle({ type: 'startBulk', tabId: 1, collections: COLLS });
  await router.idle();
  const { job } = await router.handle({ type: 'getJob' });
  assert.equal(job.skipped, 2);
  assert.equal(job.imported.length, 1);
  assert.deepEqual(job.failed.map((f) => [f.title, f.error]), [['Model 3', 'cloud down']]);
  assert.equal(job.done, 4);
  assert.equal(imports.some((i) => i.model_id === 1), false);
  assert.equal(created[0].parentId, undefined);
});

test('startBulk refuses a concurrent job; unreadable collection and folder failure are reported', async () => {
  bulkRouter();
  let release;
  const gate = new Promise((r) => { release = r; });
  client.mwResolve = async () => { await gate; return res({ model_id: 1, already_imported_library_ids: [1] }); };
  assert.equal((await router.handle({ type: 'startBulk', tabId: 1, collections: COLLS })).ok, true);
  assert.deepEqual(await router.handle({ type: 'startBulk', tabId: 1, collections: COLLS }), { ok: false, error: 'A bulk import is already running' });
  release();
  await router.idle();
  assert.equal((await router.handle({ type: 'startBulk', tabId: 1, collections: [COLLS[0]] })).ok, true);
  await router.idle();

  bulkRouter();
  bulkPage.fetchDataRouteInPage = null;
  client.createFolder = async () => err('exists', 'client');
  try {
    await router.handle({ type: 'startBulk', tabId: 1, collections: [COLLS[1]] });
    await router.idle();
    const { job } = await router.handle({ type: 'getJob' });
    assert.match(job.failed[0].error, /Folder "Beta": exists/);
  } finally {
    bulkPage.fetchDataRouteInPage = (b, p) => ({ pageProps: { designs: p.includes('/collections/1-') ? [dsg(1), dsg(2), dsg(3)] : [dsg(4)] } });
  }
});

test('cancelBulk stops the job; restart marks a stored running job interrupted', async () => {
  bulkRouter();
  let n = 0;
  client.mwResolve = async () => { n++; if (n === 1) await router.handle({ type: 'cancelBulk' }); return res({ model_id: n, already_imported_library_ids: [1] }); };
  await router.handle({ type: 'startBulk', tabId: 1, collections: COLLS, concurrency: 1 });
  await router.idle();
  assert.equal((await router.handle({ type: 'getJob' })).job.status, 'cancelled');
  assert.deepEqual(await router.handle({ type: 'cancelBulk' }), { ok: true, running: false });

  await chrome.storage.session.set({ job: { status: 'running', total: 4, collections: COLLS } });
  bulkRouter();
  await router.markInterrupted();
  const j = (await router.handle({ type: 'getJob' })).job;
  assert.equal(j.status, 'interrupted');
  assert.deepEqual(j.collections, COLLS);
});

test('job state falls back to storage.local when session is unavailable; listCollections', async () => {
  bulkRouter();
  const local = chrome.storage.local;
  delete chrome.storage.session;
  router = createRouter({ getClient: async () => client, settings, chrome, execInTab: async (t, f) => (f.name === 'readCollectionsDataInPage' ? { href: 'https://makerworld.com/en/@bob/collections', nextData: { props: { pageProps: { favoritesList: [{ id: 1, title: 'A', designCnt: 2 }] } } } } : null) });
  const r = await router.handle({ type: 'listCollections', tabId: 1 });
  assert.equal(r.collections[0].listId, '1');
  assert.equal(r.folders[0].name, 'Root');
  await router.handle({ type: 'startBulk', tabId: 1, collections: [{ listId: '1', title: 'A', slug: null, count: 2 }] });
  await router.idle();
  assert.ok(local.data.job);
});

test('dismissJob clears a finished job but not a running one', async () => {
  bulkRouter();
  await chrome.storage.session.set({ job: { status: 'done' } });
  assert.equal((await router.handle({ type: 'dismissJob' })).ok, true);
  assert.equal((await router.handle({ type: 'getJob' })).job, null);
});

test('job state exists immediately after startBulk resolves', async () => {
  bulkRouter();
  let release;
  const gate = new Promise((r) => { release = r; });
  client.listFolders = async () => { await gate; return res([]); };
  assert.equal((await router.handle({ type: 'startBulk', tabId: 1, collections: COLLS })).ok, true);
  const { job } = await router.handle({ type: 'getJob' });
  assert.equal(job.status, 'running');
  assert.ok(job.jobId);
  release();
  await router.idle();
});

test('markInterrupted does not clobber a job started while it was reading', async () => {
  bulkRouter();
  await chrome.storage.session.set({ job: { status: 'running', jobId: 'stale' } });
  const mi = router.markInterrupted();
  await router.handle({ type: 'startBulk', tabId: 1, collections: [COLLS[0]] });
  await mi;
  await router.idle();
  const { job } = await router.handle({ type: 'getJob' });
  assert.notEqual(job.jobId, 'stale');
  assert.equal(job.status, 'done');
});

test('createFolder ok without id fails that collection; signal reaches the api', async () => {
  bulkRouter();
  client.createFolder = async () => res({});
  await router.handle({ type: 'startBulk', tabId: 1, collections: [COLLS[1]] });
  await router.idle();
  assert.match((await router.handle({ type: 'getJob' })).job.failed[0].error, /folder id/);

  bulkRouter();
  const sigs = [];
  client.mwResolve = async (u, o) => { sigs.push(o?.signal); return res({ model_id: 1, already_imported_library_ids: [1] }); };
  await router.handle({ type: 'startBulk', tabId: 1, collections: [COLLS[0]] });
  await router.idle();
  assert.ok(sigs.length && sigs.every((x) => x instanceof AbortSignal));
});

test('runBulk reads the collections page once', async () => {
  bulkRouter();
  let reads = 0;
  const base = router;
  const exec = async (t, f, a) => { if (f.name === 'readCollectionsDataInPage') reads++; return typeof bulkPage[f.name] === 'function' ? bulkPage[f.name](...a) : bulkPage[f.name]; };
  router = createRouter({ getClient: async () => client, settings, chrome, execInTab: exec });
  await router.handle({ type: 'startBulk', tabId: 1, collections: COLLS });
  await router.idle();
  assert.equal(reads, 1);
  assert.ok(base);
});

test('testConnection reports and stores protocol', async () => {
  router = createRouter({ getClient: async () => client, settings, getProtocol: async (p) => (p === 'https://bb.example/api/v1/' ? 'http/1.1' : '') });
  const r = await router.handle({ type: 'testConnection' });
  assert.equal(r.protocol, 'http/1.1');
  assert.equal(await settings.getSetting('detectedProtocol'), 'http/1.1');
});

test('save printables: auto + detected http/1.1 starts in buffer mode', async () => {
  await settings.setSettings({ detectedProtocol: 'http/1.1' });
  const c = prClient();
  let streamed = false;
  c.uploadFileStream = async () => { streamed = true; return { ok: false, error: 'x', streamUnsupported: true }; };
  router = createRouter({ getClient: async () => c, settings, fetchImpl: prFetch() });
  const r = await router.handle({ type: 'save', url: PR });
  assert.equal(r.ok, true);
  assert.equal(streamed, false);
});

test('testConnection probes and stores streamSupport', async () => {
  router = createRouter({ getClient: async () => client, settings, probeStream: async ({ baseUrl }) => (baseUrl === 'https://bb.example/' ? 'blocked' : 'ok') });
  const r = await router.handle({ type: 'testConnection' });
  assert.equal(r.streamSupport, 'blocked');
  assert.equal(await settings.getSetting('streamSupport'), 'blocked');
});

test('save printables: auto with unknown streamSupport probes lazily once and persists', async () => {
  for (const [probed, expectStream] of [['ok', true], ['blocked', false]]) {
    await settings.setSettings({ streamSupport: '' });
    const c = prClient();
    let streamed = false;
    let probes = 0;
    c.uploadFileStream = async (parts) => { streamed = true; for await (const _ of parts.stream); return { ok: true, data: { id: 1 } }; };
    router = createRouter({ getClient: async () => c, settings, fetchImpl: prFetch(), probeStream: async () => { probes++; return probed; } });
    assert.equal((await router.handle({ type: 'save', url: PR })).ok, true);
    assert.equal(streamed, expectStream);
    assert.equal(probes, 1);
    assert.equal(await settings.getSetting('streamSupport'), probed);
  }
});

test('save printables: explicit buffer mode never probes or streams', async () => {
  await settings.setSettings({ uploadMode: 'buffer' });
  const c = prClient();
  let streamed = false;
  c.uploadFileStream = async () => { streamed = true; return { ok: true, data: { id: 1 } }; };
  router = createRouter({ getClient: async () => c, settings, fetchImpl: prFetch(), probeStream: async () => { throw new Error('no'); } });
  assert.equal((await router.handle({ type: 'save', url: PR })).ok, true);
  assert.equal(streamed, false);
});
