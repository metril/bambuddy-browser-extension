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
  const r = await router.handle({ type: 'getPickerData', url: 'https://www.printables.com/model/9-x' });
  assert.equal(r.site, 'printables');
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
  assert.deepEqual(await router.handle({ type: 'save', url: 'https://www.printables.com/model/9-x' }), { ok: false, error: 'Not supported yet', site: 'printables' });
  assert.equal((await router.handle({ type: 'save', url: 'https://example.com' })).ok, false);
  client.mwResolve = async () => { throw new Error('boom'); };
  const r = await router.handle({ type: 'save', url: MW });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'boom');
});
