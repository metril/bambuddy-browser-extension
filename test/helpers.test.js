import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeChrome } from './helpers/fakeChrome.js';
import { createFakeFetch } from './helpers/fakeFetch.js';

test('fakeChrome storage, onChanged and recorders', async () => {
  const c = createFakeChrome();
  const seen = [];
  c.storage.local.onChanged.addListener((ch) => seen.push(ch));
  await c.storage.local.set({ a: 1 });
  assert.deepEqual(await c.storage.local.get('a'), { a: 1 });
  assert.deepEqual(await c.storage.local.get({ a: 0, b: 2 }), { a: 1, b: 2 });
  await c.storage.local.remove('a');
  assert.deepEqual(await c.storage.local.get(['a']), {});
  assert.equal(seen.length, 2);
  assert.deepEqual(await c.storage.session.get(null), {});
  await c.alarms.create('x', { delayInMinutes: 1 });
  await c.alarms.clear('x');
  await c.action.setBadgeText({ text: 'OK' });
  await c.action.setBadgeBackgroundColor({ color: '#0f0' });
  await c.notifications.create('n', { title: 't' });
  await c.runtime.sendMessage({ type: 'm' });
  assert.equal(c.calls.alarmsCreate.length, 1);
  assert.deepEqual(c.calls.alarmsClear, ['x']);
  assert.equal(c.calls.badgeText[0].text, 'OK');
  assert.equal(c.calls.badgeColor.length, 1);
  assert.equal(c.calls.notifications.length, 1);
  assert.deepEqual(c.calls.messages, [{ type: 'm' }]);
});

test('fakeFetch queue and recording', async () => {
  const f = createFakeFetch([{ json: { ok: true } }, { status: 404, text: 'nope' }, new Error('boom')]);
  const r1 = await f('http://a/x', { method: 'POST' });
  assert.equal(r1.ok, true);
  assert.deepEqual(await r1.json(), { ok: true });
  const r2 = await f('http://a/y');
  assert.equal(r2.ok, false);
  assert.equal(r2.status, 404);
  assert.equal(await r2.text(), 'nope');
  assert.ok(r2.body);
  await assert.rejects(() => f('http://a/z'), /boom/);
  assert.deepEqual(f.calls.map((c) => c.url), ['http://a/x', 'http://a/y', 'http://a/z']);
  assert.equal(f.calls[0].init.method, 'POST');
});
