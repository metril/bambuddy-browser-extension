import test from 'node:test';
import assert from 'node:assert/strict';
import { readCollections, readCollectionItems, fetchFavoritesInPage, readCollectionsDataInPage, collectAnchorPathnamesInPage, fetchDataRouteInPage } from '../src/lib/mwPageReaders.js';

const D = (id) => ({ id, title: `m${id}`, designCreator: { name: 'a' }, cover: `c${id}` });

// Fake exec seam keyed by function identity.
function fakeExec(handlers, log = []) {
  return async (tabId, func, args) => {
    log.push({ name: func.name, args });
    const h = handlers[func.name];
    if (h instanceof Error) throw h;
    return typeof h === 'function' ? h(...args) : h;
  };
}

const listPage = (extra = {}) => ({
  readCollectionsDataInPage: {
    href: 'https://makerworld.com/en/@bob/collections',
    nextData: { buildId: 'B', props: { pageProps: { favoritesList: [{ id: 1, title: 'One', slug: 'one', designCnt: 2 }] } } },
    routePageProps: null, ...extra,
  },
});

test('readCollections: route pageProps preferred, then NEXT_DATA', async () => {
  const route = { favoritesList: [{ id: 5, title: 'Fresh', designCnt: 1, isDefault: true }] };
  assert.deepEqual(await readCollections(fakeExec(listPage({ routePageProps: route })), 1),
    [{ listId: '5', title: 'Fresh', count: 1, isDefault: true, slug: null }]);
  assert.deepEqual(await readCollections(fakeExec(listPage()), 1),
    [{ listId: '1', title: 'One', count: 2, isDefault: false, slug: 'one' }]);
});

test('readCollections: detail page returns itself; unreadable page throws', async () => {
  const exec = fakeExec({ readCollectionsDataInPage: {
    href: 'https://makerworld.com/en/collections/9-esp', nextData: null,
    routePageProps: { favoritesInfo: { id: 9, title: 'ESP stuff', designCnt: 7 } },
  } });
  assert.deepEqual(await readCollections(exec, 1), [{ listId: '9', title: 'ESP stuff', count: 7, isDefault: false, slug: 'esp' }]);
  await assert.rejects(readCollections(fakeExec({ readCollectionsDataInPage: { href: 'https://makerworld.com/en/@b/collections', nextData: {}, routePageProps: null } }), 1), /Couldn't read/);
  await assert.rejects(readCollections(fakeExec({ readCollectionsDataInPage: new Error('x') }), 1), /Couldn't read this page/);
});

const entry = { listId: '1', title: 'One', slug: 'one', count: 2 };

test('items: data route via anchor path wins, no fallback when complete', async () => {
  const log = [];
  const exec = fakeExec({ ...listPage(), collectAnchorPathnamesInPage: ['/en/collections/1-anchor'],
    fetchDataRouteInPage: (b, p) => (p === '/en/collections/1-anchor' ? { pageProps: { designs: [D(1), D(2)] } } : null) }, log);
  const r = await readCollectionItems(exec, 1, entry);
  assert.deepEqual(r.items.map((i) => i.externalId), ['1', '2']);
  assert.equal(r.unreadable, false);
  assert.ok(!log.some((l) => l.name === 'fetchFavoritesInPage'));
});

test('items: constructed path tried after anchor miss', async () => {
  const log = [];
  const exec = fakeExec({ ...listPage(), collectAnchorPathnamesInPage: ['/en/collections/1-anchor'],
    fetchDataRouteInPage: (b, p) => (p === '/en/collections/1-one' ? { pageProps: { designs: [D(1), D(2)] } } : null) }, log);
  assert.equal((await readCollectionItems(exec, 1, entry)).items.length, 2);
  assert.deepEqual(log.filter((l) => l.name === 'fetchDataRouteInPage').map((l) => l.args[1]), ['/en/collections/1-anchor', '/en/collections/1-one']);
});

test('items: partial route result falls back to favorites API, larger wins; handle encoded by caller', async () => {
  const log = [];
  const exec = fakeExec({ ...listPage(), collectAnchorPathnamesInPage: [],
    fetchDataRouteInPage: { pageProps: { designs: [D(1)] } },
    fetchFavoritesInPage: [{ hits: [D(1), D(2)] }] }, log);
  const r = await readCollectionItems(exec, 1, entry);
  assert.equal(r.items.length, 2);
  assert.deepEqual(log.find((l) => l.name === 'fetchFavoritesInPage').args, ['1', 'bob', [0]]);
});

test('items: route 404 then fallback; nothing at all is unreadable', async () => {
  const base = { ...listPage(), collectAnchorPathnamesInPage: [], fetchDataRouteInPage: null };
  const r = await readCollectionItems(fakeExec({ ...base, fetchFavoritesInPage: [{ hits: [D(3)] }] }), 1, entry);
  assert.equal(r.items.length, 1);
  assert.equal(r.unreadable, false);
  const u = await readCollectionItems(fakeExec({ ...base, fetchFavoritesInPage: [null] }), 1, entry);
  assert.deepEqual(u, { items: [], unreadable: true });
  assert.deepEqual(await readCollectionItems(fakeExec({ readCollectionsDataInPage: new Error('x') }), 1, entry), { items: [], unreadable: true });
});

test('items: trusted-empty route is a genuinely empty collection, not unreadable', async () => {
  const exec = fakeExec({ ...listPage(), collectAnchorPathnamesInPage: [], fetchDataRouteInPage: { pageProps: { designs: [] } } });
  assert.deepEqual(await readCollectionItems(exec, 1, { ...entry, count: 0 }), { items: [], unreadable: false });
});

test('fetchFavoritesInPage encodes the handle and survives bad responses', async () => {
  const urls = [];
  globalThis.fetch = async (u) => { urls.push(u); if (urls.length === 2) throw new Error('net'); return { json: async () => ({ hits: [] }) }; };
  try {
    const pages = await fetchFavoritesInPage('7', 'a b&c', [0, 20]);
    assert.match(urls[0], /handle=@a%20b%26c&limit=20&offset=0$/);
    assert.deepEqual(pages, [{ hits: [] }, null]);
  } finally { delete globalThis.fetch; }
});

test('in-page readers run against a fake DOM', async () => {
  globalThis.location = { pathname: '/en/@bob/collections/', href: 'https://makerworld.com/en/@bob/collections/', origin: 'https://makerworld.com' };
  globalThis.document = {
    getElementById: () => ({ textContent: '{"buildId":"B"}' }),
    querySelectorAll: () => [{ href: 'https://makerworld.com/en/collections/1-a' }, { href: 'https://other.com/collections/2' }, { href: 'https://makerworld.com/en/models/3' }, { href: 'https://makerworld.com/en/collections/1-a' }],
  };
  const urls = [];
  globalThis.fetch = async (u) => { urls.push(u); return { ok: true, json: async () => ({ pageProps: { x: 1 } }) }; };
  try {
    const p = await readCollectionsDataInPage();
    assert.equal(urls[0], '/_next/data/B/en/@bob/collections.json');
    assert.deepEqual(p.routePageProps, { x: 1 });
    assert.deepEqual(collectAnchorPathnamesInPage(), ['/en/collections/1-a']);
    assert.deepEqual(await fetchDataRouteInPage('B', '/en/collections/1'), { pageProps: { x: 1 } });
  } finally { delete globalThis.fetch; delete globalThis.document; delete globalThis.location; }
});

test('readCollectionItems uses a preloaded page without re-reading', async () => {
  const log = [];
  const exec = fakeExec({ collectAnchorPathnamesInPage: [], fetchDataRouteInPage: { pageProps: { designs: [D(1), D(2)] } } }, log);
  const { readCollectionsPage } = await import('../src/lib/mwPageReaders.js');
  const page = listPage().readCollectionsDataInPage;
  const r = await readCollectionItems(exec, 1, entry, page);
  assert.equal(r.items.length, 2);
  assert.ok(!log.some((l) => l.name === 'readCollectionsDataInPage'));
  assert.equal(typeof readCollectionsPage, 'function');
});
