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

test('profileOptions selects the first profile when the default matches none', () => {
  const o = profileOptions({ defaultProfileId: 99, profiles: [{ id: 1, title: 'a' }, { id: 2, title: 'b' }] });
  assert.deepEqual(o.map((x) => x.selected), [true, false]);
  assert.deepEqual(profileOptions({ defaultProfileId: 1, profiles: [] }), []);
});

test('profileOptions', () => {
  const o = profileOptions({ defaultProfileId: 2, profiles: [{ id: 1, title: 'a', instanceId: 11 }, { id: 2, title: 'b' }] });
  assert.deepEqual(o.map((x) => x.selected), [false, true]);
  assert.equal(o[0].instanceId, 11);
  assert.deepEqual(profileOptions(null), []);
});

import { summarizeUploadResult } from '../src/lib/popupState.js';

test('summarizeUploadResult buckets results, flags duplicates, lists skipped once', () => {
  const s = summarizeUploadResult({
    results: [
      { filename: 'a.3mf', ok: true, id: 1 },
      { filename: 'b.stl', ok: true, id: 2, duplicateOf: 7 },
      { filename: 'c.stl', ok: false, error: 'boom' },
    ],
    skipped: [{ filename: 'd.gcode', reason: 'unsupported' }, { filename: 'e.stl', reason: 'too-large' }],
    warnings: ['Skipped d.gcode: unsupported file type', 'Skipped e.stl: larger than 1 MB', 'Thumbnail failed: x'],
  });
  assert.deepEqual(s.imported, [{ filename: 'a.3mf' }]);
  assert.deepEqual(s.duplicates, [{ filename: 'b.stl', duplicateOf: 7 }]);
  assert.deepEqual(s.failed, [{ filename: 'c.stl', error: 'boom' }]);
  assert.deepEqual(s.skipped, [{ filename: 'd.gcode', reason: 'unsupported file type' }, { filename: 'e.stl', reason: 'larger than the size limit' }]);
  assert.deepEqual(s.warnings, ['Thumbnail failed: x']);
  assert.deepEqual(summarizeUploadResult(undefined), { imported: [], duplicates: [], failed: [], skipped: [], warnings: [] });
});

import { collectionChoices, selectedCollections, jobView } from '../src/lib/popupState.js';

test('deriveState recognises collection pages', () => {
  assert.equal(deriveState({ settings: ok, tabUrl: 'https://makerworld.com/en/@bob/collections' }).state, 'collections');
  assert.equal(deriveState({ settings: ok, tabUrl: 'https://makerworld.com/en/collections/5-x' }).state, 'collection');
});

test('collection checklist helpers', () => {
  const cs = [{ listId: '1', title: 'A', count: 3, slug: 'a', isDefault: true }, { listId: '2', title: 'B', count: null, slug: null }];
  assert.deepEqual(collectionChoices(cs, ['2']), [{ value: '1', label: 'A (3)', checked: false }, { value: '2', label: 'B', checked: true }]);
  assert.deepEqual(selectedCollections(cs, ['2']), [{ listId: '2', title: 'B', slug: null, count: null }]);
});

test('jobView: progress, interrupted, summary, expiry', () => {
  assert.equal(jobView(null).kind, 'none');
  assert.equal(jobView({ status: 'running', phase: 'preparing', total: 0 }).text, 'Reading collections...');
  const p = jobView({ status: 'running', total: 4, done: 1, skipped: 1, failed: [{}] });
  assert.deepEqual([p.kind, p.percent, p.text], ['progress', 25, '1 / 4 done, 1 skipped, 1 failed']);
  assert.equal(jobView({ status: 'interrupted', total: 4, done: 2, imported: [{}], skipped: 1, failed: [] }).kind, 'interrupted');
  const s = jobView({ status: 'done', total: 2, done: 2, imported: [{}], skipped: 0, failed: [{ title: 'x', error: 'e' }], finishedAt: 1000, openUrl: 'u' }, 2000);
  assert.deepEqual([s.kind, s.text, s.openUrl, s.failures], ['summary', 'Imported 1, skipped 0, failed 1', 'u', [{ title: 'x', error: 'e' }]]);
  assert.equal(jobView({ status: 'cancelled', finishedAt: 1, failed: [] }, 2000).text.startsWith('Cancelled.'), true);
  assert.equal(jobView({ status: 'done', finishedAt: 1, failed: [] }, 1e9).kind, 'none');
});
