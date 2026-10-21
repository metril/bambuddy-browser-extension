import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeChrome } from './helpers/fakeChrome.js';
import { DEFAULTS, getSetting, setSetting, getSettings, setSettings, isConfigured, normalizeBaseUrl, onSettingsChanged } from '../src/lib/settings.js';

let chrome;
beforeEach(() => {
  chrome = createFakeChrome();
  globalThis.chrome = chrome;
});

test('defaults applied', async () => {
  assert.equal(await getSetting('maxFileMB'), 250);
  assert.equal(await getSetting('tagUploads'), true);
  assert.deepEqual(await getSettings(), DEFAULTS);
  assert.deepEqual(await getSettings(['baseUrl', 'lastFolderId']), { baseUrl: '', lastFolderId: null });
});

test('defaults are not shared mutable state', async () => {
  const d = await getSetting('diagnostics');
  d.x = 1;
  assert.deepEqual(await getSetting('diagnostics'), {});
});

test('one storage key per field, setSettings is a single set call', async () => {
  let sets = 0;
  const orig = chrome.storage.local.set;
  chrome.storage.local.set = (o) => { sets++; return orig(o); };
  await setSettings({ baseUrl: 'https://b', apiKey: 'k' });
  assert.equal(sets, 1);
  await setSetting('lastFolderId', 7);
  assert.deepEqual(chrome.storage.local.data, { baseUrl: 'https://b', apiKey: 'k', lastFolderId: 7 });
  assert.equal(await getSetting('lastFolderId'), 7);
});

test('concurrent writes to different fields do not lose updates', async () => {
  await Promise.all([setSetting('baseUrl', 'https://a'), setSetting('lastFolderId', 3)]);
  assert.deepEqual(await getSettings(['baseUrl', 'lastFolderId']), { baseUrl: 'https://a', lastFolderId: 3 });
});

test('isConfigured', () => {
  assert.equal(isConfigured({ baseUrl: 'https://b', apiKey: 'k' }), true);
  assert.equal(isConfigured({ baseUrl: 'https://b', apiKey: '' }), false);
  assert.equal(isConfigured({ baseUrl: '', apiKey: 'k' }), false);
  assert.equal(isConfigured(undefined), false);
});

test('normalizeBaseUrl', () => {
  assert.equal(normalizeBaseUrl('  bambuddy.example.com/ '), 'https://bambuddy.example.com');
  assert.equal(normalizeBaseUrl('http://10.0.0.5:8000///'), 'http://10.0.0.5:8000');
  assert.equal(normalizeBaseUrl('https://x.com/api/v1'), 'https://x.com');
  assert.equal(normalizeBaseUrl('https://x.com/sub/api/v1/'), 'https://x.com/sub');
  assert.equal(normalizeBaseUrl('https://x.com/?a=1#h'), 'https://x.com');
  assert.equal(normalizeBaseUrl(''), '');
  assert.equal(normalizeBaseUrl('http://'), '');
  assert.equal(normalizeBaseUrl('ftp://x.com'), '');
  assert.equal(normalizeBaseUrl(null), '');
});

test('onSettingsChanged filters to local area and unsubscribes', () => {
  const ls = [];
  chrome.storage.onChanged = {
    addListener: (f) => ls.push(f),
    removeListener: (f) => ls.splice(ls.indexOf(f), 1),
  };
  const seen = [];
  const off = onSettingsChanged((c) => seen.push(c));
  ls[0]({ a: 1 }, 'sync');
  ls[0]({ b: 2 }, 'local');
  assert.deepEqual(seen, [{ b: 2 }]);
  off();
  assert.equal(ls.length, 0);
});
