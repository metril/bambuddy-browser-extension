import test from 'node:test';
import assert from 'node:assert/strict';
import { flattenFolders } from '../src/lib/folders.js';

test('null/non-array -> []', () => {
  assert.deepEqual(flattenFolders(null), []);
  assert.deepEqual(flattenFolders({}), []);
});

test('nested, sorted by name, depth-first', () => {
  const tree = [
    { id: 2, name: 'b', children: [{ id: 4, name: 'z', children: [] }, { id: 5, name: 'a' }] },
    { id: 1, name: 'a', children: [] },
  ];
  assert.deepEqual(flattenFolders(tree), [
    { id: 1, name: 'a', depth: 0, path: 'a' },
    { id: 2, name: 'b', depth: 0, path: 'b' },
    { id: 5, name: 'a', depth: 1, path: 'b/a' },
    { id: 4, name: 'z', depth: 1, path: 'b/z' },
  ]);
});

test('flat with parent_id is rebuilt; orphans become roots', () => {
  const flat = [
    { id: 3, name: 'c', parent_id: 2 },
    { id: 2, name: 'b', parent_id: 1 },
    { id: 1, name: 'a', parent_id: null },
    { id: 9, name: 'o', parent_id: 99 },
  ];
  assert.deepEqual(flattenFolders(flat).map((f) => [f.id, f.depth, f.path]), [
    [1, 0, 'a'], [2, 1, 'a/b'], [3, 2, 'a/b/c'], [9, 0, 'o'],
  ]);
});

test('childFolders handles nested and flat trees', async () => {
  const { childFolders } = await import('../src/lib/folders.js');
  const nested = [{ id: 1, name: 'A', children: [{ id: 2, name: 'B', children: [] }] }, { id: 3, name: 'C' }];
  assert.deepEqual(childFolders(nested, null), [{ id: 1, name: 'A' }, { id: 3, name: 'C' }]);
  assert.deepEqual(childFolders(nested, 1), [{ id: 2, name: 'B' }]);
  const flat = [{ id: 1, name: 'A', parent_id: null }, { id: 2, name: 'B', parent_id: 1 }];
  assert.deepEqual(childFolders(flat, 1), [{ id: 2, name: 'B' }]);
  assert.deepEqual(childFolders(flat), [{ id: 1, name: 'A' }]);
  assert.deepEqual(childFolders(null, 1), []);
});
