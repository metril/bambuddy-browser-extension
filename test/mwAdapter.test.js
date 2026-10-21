import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toPickerModel, buildImportBody, canonicalUrl } from '../src/lib/adapters/makerworld.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/mw-resolve.json', import.meta.url)));

test('toPickerModel from live fixture', () => {
  const m = toPickerModel(fixture);
  assert.equal(m.title, 'Mewtwo 2D');
  assert.equal(m.designer, 'DAMA3D');
  assert.match(m.thumbnail, /^https:/);
  assert.equal(m.defaultProfileId, 53897437);
  assert.equal(m.profiles.length, 1);
  assert.equal(m.profiles[0].id, 53897437);
  assert.equal(m.profiles[0].instanceId, 220545);
  assert.match(m.profiles[0].title, /0\.2mm nozzle.*X1 Carbon/);
  assert.deepEqual(m.alreadyImported, []);
  assert.equal(m.paid, false);
});

test('resolved.profile_id (URL fragment) wins', () => {
  const m = toPickerModel({ ...fixture, profile_id: 7, already_imported_library_ids: [3] });
  assert.equal(m.defaultProfileId, 7);
  assert.deepEqual(m.alreadyImported, [3]);
});

test('default via defaultInstanceId, then first profile', () => {
  const r = { design: { defaultInstanceId: 2 }, instances: [{ id: 1, profileId: 10 }, { id: 2, profileId: 20, title: 'B' }] };
  assert.equal(toPickerModel(r).defaultProfileId, 20);
  assert.equal(toPickerModel({ instances: r.instances }).defaultProfileId, 10);
});

test('profile fallbacks: id, title, thumbnail', () => {
  const m = toPickerModel({ instances: [{ id: 5, pictures: [{ url: 'p.png' }] }, { id: 6, profileId: 9, profileTitle: 'PT' }] });
  assert.equal(m.profiles[0].id, 5);
  assert.equal(m.profiles[0].title, 'Profile 5');
  assert.equal(m.profiles[0].thumbnail, 'p.png');
  assert.equal(m.profiles[1].title, 'PT');
});

test('tolerates missing fields', () => {
  for (const x of [null, undefined, {}, 'x', { design: null, instances: 3 }]) {
    const m = toPickerModel(x);
    assert.equal(m.title, null);
    assert.equal(m.designer, null);
    assert.equal(m.thumbnail, null);
    assert.equal(m.defaultProfileId, null);
    assert.deepEqual(m.profiles, []);
    assert.deepEqual(m.alreadyImported, []);
  }
});

test('paid flag', () => {
  assert.equal(toPickerModel({ design: { paidSetting: { isPaid: true } } }).paid, true);
});

test('buildImportBody omits nulls', () => {
  assert.deepEqual(buildImportBody({ modelId: 1, profileId: null, folderId: null }), { source_type: 'makerworld', model_id: 1 });
  assert.deepEqual(buildImportBody({ modelId: 1, profileId: 2, instanceId: 3, folderId: 4 }), {
    source_type: 'makerworld', model_id: 1, profile_id: 2, instance_id: 3, folder_id: 4,
  });
});

test('canonicalUrl', () => {
  assert.equal(canonicalUrl(42), 'https://makerworld.com/en/models/42');
});
