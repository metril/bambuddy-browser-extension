import test from 'node:test';
import assert from 'node:assert/strict';
import { isInsecureRemote, validateSettingsInput, describeConnection, originPattern } from '../src/lib/optionsLogic.js';

test('isInsecureRemote', () => {
  for (const u of ['https://bb.example', 'http://localhost:8000', 'http://127.0.0.1', 'http://[::1]:80', 'http://192.168.1.5', 'http://10.0.0.1', 'http://172.16.0.1', 'http://172.31.9.9', 'http://[fd12::1]', 'http://printer.local', 'http://a.lan', 'http://a.internal', 'http://a.home.arpa', 'http://bambuddy:8000', 'http://nas', '', 'junk'])
    assert.equal(isInsecureRemote(u), false, u);
  for (const u of ['http://bb.example', 'http://8.8.8.8', 'http://172.32.0.1', 'http://172.15.0.1', 'http://192.169.0.1', 'http://[2001:db8::1]'])
    assert.equal(isInsecureRemote(u), true, u);
});

test('validateSettingsInput', () => {
  assert.deepEqual(validateSettingsInput({ baseUrl: 'bb.local', apiKey: 'bb_x' }), { ok: true, errors: [], warnings: [] });
  const e = validateSettingsInput({ baseUrl: '', apiKey: 'bb_x' });
  assert.equal(e.ok, false);
  assert.equal(e.errors.length, 1);
  assert.equal(validateSettingsInput({ baseUrl: 'ftp://x', apiKey: 'bb_x' }).ok, false);
  assert.equal(validateSettingsInput({ baseUrl: 'https://x', apiKey: '' }).ok, false);
  const w = validateSettingsInput({ baseUrl: 'https://x', apiKey: 'abc' });
  assert.equal(w.ok, true);
  assert.match(w.warnings[0], /bb_/);
  const i = validateSettingsInput({ baseUrl: 'http://example.com', apiKey: 'bb_x' });
  assert.match(i.warnings.join(), /unencrypted/);
});

test('originPattern', () => {
  assert.equal(originPattern('bb.example:8000/sub/'), 'https://bb.example:8000/*');
  assert.equal(originPattern('http://10.0.0.2:8000/api/v1'), 'http://10.0.0.2:8000/*');
  assert.equal(originPattern(''), '');
});

test('describeConnection says API key rejected', () => {
  assert.deepEqual(describeConnection({ ok: false, kind: 'auth', error: 'API key rejected' }), ['API key rejected']);
});

test('describeConnection expired session', () => {
  assert.ok(describeConnection({ ok: true, auth: {}, mw: { has_cloud_token: true, sign_in_expired: true } }).includes('MakerWorld cloud: sign-in expired'));
});

test('describeConnection prints the scope note as the last line', () => {
  const note = 'Write access (can_manage_library) is only verified on first upload.';
  assert.equal(describeConnection({ ok: true, auth: {}, mw: null, streamSupport: 'ok', scopeNote: note }).at(-1), note);
  assert.ok(!describeConnection({ ok: true, auth: {}, mw: null }).includes(note));
});

test('describeConnection', () => {
  assert.deepEqual(describeConnection({ ok: false, error: 'bad key' }), ['Connection failed: bad key']);
  const l = describeConnection({ ok: true, auth: { auth_enabled: true }, mw: { has_cloud_token: true }, protocol: 'h2' });
  assert.deepEqual(l, ['Auth: enabled', 'API key accepted', 'MakerWorld cloud: signed in', 'HTTP protocol: h2', 'Streaming uploads: unknown (run Test connection)']);
  const l2 = describeConnection({ ok: true, auth: { auth_enabled: false }, mw: { has_cloud_token: false } });
  assert.deepEqual(l2, ['Auth: disabled', 'API key accepted', 'MakerWorld cloud: no cloud token', 'Streaming uploads: unknown (run Test connection)']);
  const sl = (streamSupport) => describeConnection({ ok: true, auth: {}, mw: null, streamSupport }).at(-1);
  assert.equal(sl('ok'), 'Streaming uploads: supported');
  assert.match(sl('blocked'), /blocked by your proxy \(buffer mode will be used\)/);
  assert.match(sl('h1'), /not available over HTTP\/1\.1/);
  assert.match(describeConnection({ ok: true, auth: {}, mw: null, error: 'token expired' }).join(), /sign-in expired/);
});
