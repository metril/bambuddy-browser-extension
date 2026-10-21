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
  assert.equal(opts.iconUrl, 'icons/icon128.png');
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
