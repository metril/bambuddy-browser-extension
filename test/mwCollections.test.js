import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../src/lib/mwCollections.js';

const list = [
  { id: 11, title: 'Fav', slug: 'fav', designCnt: 3, isDefault: true },
  { id: 12, title: 'ESP', designCnt: 0 },
  { id: 0, title: 'bad' }, null, { id: 13 },
];

test('parseNextData / buildId / route url', () => {
  assert.equal(c.parseNextData('{bad'), null);
  assert.equal(c.parseNextData(null), null);
  assert.equal(c.buildIdOf(c.parseNextData('{"buildId":"abc"}')), 'abc');
  assert.equal(c.buildIdOf({}), null);
  assert.equal(c.dataRouteUrl('b', '/en/collections/1-x/'), '/_next/data/b/en/collections/1-x.json');
});

test('favorites list from NEXT_DATA or pageProps', () => {
  const want = [
    { list_id: '11', title: 'Fav', slug: 'fav', count: 3, is_default: true },
    { list_id: '12', title: 'ESP', slug: null, count: 0, is_default: false },
  ];
  assert.deepEqual(c.extractFavoritesListFrom({ props: { pageProps: { favoritesList: list } } }), want);
  assert.deepEqual(c.extractFavoritesListFrom({ favoritesList: list }), want);
  assert.deepEqual(c.extractFavoritesListFrom({}), []);
  assert.equal(c.hasFavoritesList({ favoritesList: [] }), true);
  assert.equal(c.hasFavoritesList({}), false);
});

test('extractHandle prefers url, decodes, falls back to next data', () => {
  assert.equal(c.extractHandle(null, 'https://makerworld.com/en/@a%20b/collections'), 'a b');
  assert.equal(c.extractHandle({ props: { pageProps: { userInfo: { name: 'zed' } } } }, 'https://makerworld.com/en/x'), 'zed');
  assert.equal(c.extractHandle(null, 'nope'), null);
});

test('detail url parsing is plural-only; anchors tolerate singular for known ids', () => {
  assert.deepEqual(c.parseCollectionDetailUrl('https://makerworld.com/en/collections/18925823-esp32'), { id: '18925823', slug: 'esp32' });
  assert.deepEqual(c.parseCollectionDetailUrl('https://makerworld.com/collections/5'), { id: '5', slug: null });
  assert.equal(c.parseCollectionDetailUrl('https://makerworld.com/en/collection/5'), null);
  assert.equal(c.parseCollectionDetailUrl('https://makerworld.com/en/@me/collections'), null);
  const m = c.matchCollectionLinks(['https://makerworld.com/en/collection/5-a/?x=1', 'https://evil.com/en/collections/6', '/en/collections/7', 'https://makerworld.com/en/collections/8'], ['5', '6', '7']);
  assert.deepEqual([...m], [['5', '/en/collection/5-a'], ['7', '/en/collections/7']]);
});

test('collectionDetailPathnameFrom keeps locale, encodes slug', () => {
  assert.equal(c.collectionDetailPathnameFrom('https://makerworld.com/de/@me/collections', '9', 'a b'), '/de/collections/9-a%20b');
  assert.equal(c.collectionDetailPathnameFrom('https://makerworld.com/@me/collections', '9', null), '/collections/9');
});

test('findCollectionTitleIn', () => {
  assert.deepEqual(c.findCollectionTitleIn({ favoritesInfo: { id: 5, title: 'T', designCnt: 4 } }, '5'), { title: 'T', count: 4 });
  assert.deepEqual(c.findCollectionTitleIn({ x: { y: { id: 5, title: 'N', count: 2 } } }, '5'), { title: 'N', count: 2 });
  assert.equal(c.findCollectionTitleIn({ favoritesInfo: { id: 6, title: 'T' } }, '5'), null);
});

test('mapDesignHits maps to camelCase items, skips junk, falls back to name', () => {
  const r = c.mapDesignHits({ hits: [{ id: 1, title: 'A', designCreator: { name: 'x' }, cover: 'u' }, { id: 2, name: 'B' }, { id: 3 }, null] });
  assert.deepEqual(r, [
    { externalId: '1', title: 'A', url: 'https://makerworld.com/en/models/1', author: 'x', thumbnailUrl: 'u' },
    { externalId: '2', title: 'B', url: 'https://makerworld.com/en/models/2', author: null, thumbnailUrl: null },
  ]);
  assert.deepEqual(c.mapDesignHits(null), []);
});

test('findDesignListIn: named keys, trusted empties, exclusions, deep scan', () => {
  const d = [{ id: 1, title: 'a' }, { id: 2, name: 'b' }];
  assert.equal(c.findDesignListIn({ designs: d }).key, 'designs');
  assert.deepEqual(c.findDesignListIn({ designs: [] }), { key: 'designs', designs: [] });
  assert.equal(c.findDesignListIn({ list: [] }), null);
  assert.equal(c.findDesignListIn({ favoritesList: [{ id: 1, title: 'c', designCnt: 2 }] }), null);
  assert.equal(c.findDesignListIn({ other: { items: d } }).key, 'other.items');
  assert.equal(c.findDesignListIn({ other: [{ id: 1, title: 'x', isDefault: true }] }), null);
  assert.equal(c.findDesignListIn(null), null);
});

test('itemOffsets caps and defaults', () => {
  assert.deepEqual(c.itemOffsets(45), [0, 20, 40]);
  assert.deepEqual(c.itemOffsets(null), [0]);
  assert.equal(c.itemOffsets(99999).length, 25);
});
