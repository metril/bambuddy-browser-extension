import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveState, folderOptions, profileOptions } from '../src/lib/popupState.js';

const ok = { baseUrl: 'https://b.example', apiKey: 'k' };

test('deriveState', () => {
  assert.equal(deriveState({ settings: { baseUrl: '', apiKey: '' }, tabUrl: 'https://makerworld.com/en/models/1-x' }).state, 'setup');
  assert.equal(deriveState({ settings: ok, tabUrl: 'https://example.com/' }).state, 'unsupported');
  assert.equal(deriveState({ settings: ok, tabUrl: undefined }).state, 'unsupported');
  assert.deepEqual(deriveState({ settings: ok, tabUrl: 'https://makerworld.com/en/models/123-x#profileId-5' }), { state: 'makerworld', site: 'makerworld', id: '123' });
  assert.equal(deriveState({ settings: ok, tabUrl: 'https://www.printables.com/model/9-x' }).state, 'printables');
});

test('folderOptions: default first, indent, preselect', () => {
  const f = [{ id: 1, name: 'a', depth: 0 }, { id: 2, name: 'b', depth: 1 }];
  const o = folderOptions(f, 2);
  assert.equal(o[0].label, 'Default (MakerWorld folder)');
  assert.equal(o[0].value, '');
  assert.equal(o[0].selected, false);
  assert.equal(o[2].selected, true);
  assert.ok(o[2].label.startsWith(' '));
  assert.equal(folderOptions(f, 99)[0].selected, true);
  assert.equal(folderOptions(f, null)[0].selected, true);
  assert.deepEqual(folderOptions(null, null).length, 1);
});

test('profileOptions', () => {
  const o = profileOptions({ defaultProfileId: 2, profiles: [{ id: 1, title: 'a', instanceId: 11 }, { id: 2, title: 'b' }] });
  assert.deepEqual(o.map((x) => x.selected), [false, true]);
  assert.equal(o[0].instanceId, 11);
  assert.deepEqual(profileOptions(null), []);
});
