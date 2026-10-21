import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeChrome } from './helpers/fakeChrome.js';
import * as settings from '../src/lib/settings.js';
import { HOST_PATTERNS } from '../src/lib/detect.js';
import { createBackground, outcomeToBadge, outcomeToNotification, menuDefinitions } from '../src/lib/backgroundLogic.js';

let fc, sent, bg, next;
beforeEach(() => {
  fc = createFakeChrome();
  globalThis.chrome = fc;
  sent = [];
  next = { ok: true, filename: 'Benchy.3mf', openUrl: 'http://bb/lib/1' };
  bg = createBackground({ chrome: fc, settings, router: { handle: async (m) => { sent.push(m); return next; } } });
});

test('menus use HOST_PATTERNS, removeAll first', async () => {
  await bg.install();
  assert.equal(fc.calls.menusRemoved, 1);
  const [page, link] = fc.calls.menus;
  assert.equal(page.id, 'bb-save-page');
  assert.deepEqual(page.documentUrlPatterns, HOST_PATTERNS);
  assert.equal(link.id, 'bb-save-link');
  assert.deepEqual(link.targetUrlPatterns, HOST_PATTERNS);
  assert.equal(menuDefinitions().length, 2);
});

test('link click saves linkUrl; page click saves pageUrl with lastFolderId', async () => {
  await settings.setSetting('lastFolderId', 7);
  await bg.onMenuClick({ menuItemId: 'bb-save-link', linkUrl: 'https://makerworld.com/en/models/1' }, { id: 3 });
  await bg.onMenuClick({ menuItemId: 'bb-save-page', pageUrl: 'https://www.printables.com/model/2-x' }, { id: 3 });
  assert.deepEqual(sent[0], { type: 'save', url: 'https://makerworld.com/en/models/1', folderId: 7 });
  assert.equal(sent[1].url, 'https://www.printables.com/model/2-x');
  assert.equal(sent[1].tabId, undefined);
});

test('thingiverse page save passes tabId', async () => {
  await bg.onMenuClick({ menuItemId: 'bb-save-page', pageUrl: 'https://www.thingiverse.com/thing:5' }, { id: 9 });
  assert.equal(sent[0].tabId, 9);
});

test('command saves active tab', async () => {
  fc.tabs.setActive({ id: 4, url: 'https://makerworld.com/en/models/5' });
  await bg.onCommand('save-current-page');
  assert.equal(sent[0].url, 'https://makerworld.com/en/models/5');
});

test('shortcut with no usable URL reports a clear message', async () => {
  fc.tabs.setActive({ id: 4 });
  const r = await bg.onCommand('save-current-page');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'Not a supported model page');
  assert.equal(sent.length, 0);
});

test('badge set, alarm scheduled, alarm clears', async () => {
  await bg.saveUrl('https://makerworld.com/en/models/1');
  assert.equal(fc.calls.badgeText.at(-1).text, '✓');
  assert.equal(fc.calls.alarmsCreate[0].name, 'badge-clear');
  await bg.onAlarm({ name: 'other' });
  assert.equal(fc.calls.badgeText.at(-1).text, '✓');
  await bg.onAlarm({ name: 'badge-clear' });
  assert.equal(fc.calls.badgeText.at(-1).text, '');
});

test('notification click opens openUrl', async () => {
  await bg.saveUrl('https://makerworld.com/en/models/1');
  const { id, opts } = fc.calls.notifications[0];
  assert.equal(opts.message, 'Imported Benchy.3mf');
  assert.equal(opts.iconUrl, 'chrome-extension://fake/icons/icon128.png');
  await bg.onNotificationClicked(id);
  assert.deepEqual(fc.calls.tabsCreated, [{ url: 'http://bb/lib/1' }]);
});

test('outcome mapping', () => {
  assert.equal(outcomeToBadge({ ok: true }).text, '✓');
  assert.equal(outcomeToBadge({ ok: true, wasExisting: true }).text, '=');
  assert.equal(outcomeToBadge({ ok: false }).text, '!');
  assert.equal(outcomeToNotification({ ok: true, wasExisting: true }).message, 'Already in library');
  assert.deepEqual(outcomeToNotification({ ok: false, error: 'boom' }), { message: 'boom', openUrl: null });
});

test('router throw becomes error outcome', async () => {
  bg = createBackground({ chrome: fc, settings, router: { handle: async () => { throw new Error('x'); } } });
  await bg.saveUrl('https://makerworld.com/en/models/1');
  assert.equal(fc.calls.badgeText.at(-1).text, '!');
});

test('badge clears via fast timeout and alarm fallback', async () => {
  const orig = globalThis.setTimeout;
  const timers = [];
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; };
  try { await bg.saveUrl('https://makerworld.com/en/models/1'); } finally { globalThis.setTimeout = orig; }
  assert.equal(timers[0].ms, 3000);
  assert.equal(fc.calls.alarmsCreate[0].name, 'badge-clear');
  timers[0].fn();
  await Promise.resolve();
  assert.equal(fc.calls.badgeText.at(-1).text, '');
});

test('notification closed removes stored url', async () => {
  await bg.saveUrl('https://makerworld.com/en/models/1');
  const { id } = fc.calls.notifications[0];
  assert.ok(fc.storage.session.data[`notifUrl:${id}`]);
  await bg.onNotificationClosed(id);
  assert.equal(fc.storage.session.data[`notifUrl:${id}`], undefined);
});

test('multi-file message counts only ok results; needsConfirmLarge message', () => {
  assert.equal(outcomeToNotification({ ok: true, results: [{ ok: true }, { ok: false }] }).message, 'Imported 1 files');
  assert.match(outcomeToNotification({ ok: false, error: 'x', needsConfirmLarge: { files: [] } }).message, /open the popup to confirm/);
});

test('flashBadge/notify throwing does not reject saveUrl', async () => {
  fc.action.setBadgeText = async () => { throw new Error('boom'); };
  fc.notifications.create = async () => { throw new Error('boom'); };
  const r = await bg.saveUrl('https://makerworld.com/en/models/1');
  assert.equal(r.ok, true);
});

test('bulk finish: notification summary with folder link, badge, job-tick alarm ignored', async () => {
  const r = await bg.onJobFinished({ status: 'done', imported: [{}, {}], skipped: 1, failed: [{}], openUrl: 'http://bb/files?folder=3' });
  assert.equal(r.ok, false);
  assert.equal(fc.calls.notifications[0].opts.message, 'Imported 2, skipped 1, failed 1');
  assert.equal(fc.calls.badgeText.at(-1).text, '!');
  await bg.onNotificationClicked(fc.calls.notifications[0].id);
  assert.deepEqual(fc.calls.tabsCreated, [{ url: 'http://bb/files?folder=3' }]);
  await bg.onAlarm({ name: 'job-tick' });
});

test('saveUrl keeps the worker alive every 20s and clears the interval', async () => {
  const real = { si: globalThis.setInterval, ci: globalThis.clearInterval };
  const started = [];
  const cleared = [];
  globalThis.setInterval = (fn, ms) => { started.push({ fn, ms }); return started.length; };
  globalThis.clearInterval = (id) => cleared.push(id);
  try {
    let release;
    const gate = new Promise((r) => { release = r; });
    bg = createBackground({ chrome: fc, settings, router: { handle: async () => { await gate; return next; } } });
    const p = bg.saveUrl('https://makerworld.com/en/models/1');
    await new Promise((r) => setImmediate(r));
    assert.equal(started[0].ms, 20000);
    assert.deepEqual(cleared, []);
    started[0].fn();
    assert.equal(fc.calls.platformInfo, 1);
    release();
    await p;
    assert.deepEqual(cleared, [1]);

    bg = createBackground({ chrome: fc, settings, router: { handle: async () => { throw new Error('x'); } } });
    await bg.saveUrl('https://makerworld.com/en/models/1');
    assert.deepEqual(cleared, [1, 2]);
  } finally {
    globalThis.setInterval = real.si;
    globalThis.clearInterval = real.ci;
  }
});
