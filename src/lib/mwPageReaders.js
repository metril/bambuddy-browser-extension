// Read MakerWorld collection data through a tab. The *InPage functions are
// serialized by chrome.scripting, so they must stay fully self-contained.
import {
  buildIdOf, collectionDetailPathnameFrom, extractFavoritesListFrom, extractHandle, findCollectionTitleIn,
  findDesignListIn, hasFavoritesList, itemOffsets, mapDesignHits, matchCollectionLinks, parseCollectionDetailUrl,
} from './mwCollections.js';

export async function readCollectionsDataInPage() {
  let nextData = null;
  try { nextData = JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent ?? 'null'); } catch { nextData = null; }
  let routePageProps = null;
  const buildId = nextData?.buildId;
  if (buildId) {
    try {
      const r = await fetch(`/_next/data/${buildId}${location.pathname.replace(/\/$/, '')}.json`, { credentials: 'include' });
      if (r.ok) routePageProps = (await r.json())?.pageProps ?? null;
    } catch { routePageProps = null; }
  }
  return { nextData, routePageProps, href: location.href };
}

export function collectAnchorPathnamesInPage() {
  const seen = new Set();
  const out = [];
  for (const a of document.querySelectorAll('a[href]')) {
    let u;
    try { u = new URL(a.href); } catch { continue; }
    if (u.origin !== location.origin || !/\/collections?\//i.test(u.pathname) || seen.has(u.pathname)) continue;
    seen.add(u.pathname);
    out.push(u.pathname);
  }
  return out;
}

export async function fetchDataRouteInPage(buildId, pathname) {
  try {
    const r = await fetch(`/_next/data/${buildId}${pathname}.json`, { credentials: 'include' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export async function fetchFavoritesInPage(listId, handle, offsets) {
  const pages = [];
  for (const offset of offsets) {
    try {
      const r = await fetch(
        `/api/v1/design-service/favorites/designs/${listId}?handle=@${encodeURIComponent(handle)}&limit=20&offset=${offset}`,
        { credentials: 'include', headers: { 'x-bbl-client-type': 'web', 'x-bbl-app-source': 'makerworld' } },
      );
      pages.push(await r.json());
    } catch { pages.push(null); }
  }
  return pages;
}

async function readPage(execInTab, tabId) {
  try { return (await execInTab(tabId, readCollectionsDataInPage, [])) ?? null; } catch { return null; }
}

const toEntry = (e) => ({ listId: e.list_id, title: e.title, count: e.count, isDefault: e.is_default, slug: e.slug });
const withTitle = (designs) => designs.map((d) => (d && !d.title && d.name ? { ...d, title: d.name } : d));

/** -> [{listId,title,count,isDefault,slug}]; a collection detail page yields just itself. */
export async function readCollections(execInTab, tabId) {
  const page = await readPage(execInTab, tabId);
  if (!page) throw new Error("Couldn't read this page. Reload it and try again.");
  const { nextData, routePageProps, href } = page;
  const detail = parseCollectionDetailUrl(href);
  if (detail) {
    const pp = routePageProps ?? nextData?.props?.pageProps ?? null;
    const info = findCollectionTitleIn(pp, detail.id);
    return [{
      listId: detail.id, title: info?.title || (detail.slug ? decodeURIComponent(detail.slug) : `Collection ${detail.id}`),
      count: info?.count ?? null, isDefault: false, slug: detail.slug,
    }];
  }
  for (const src of [routePageProps, nextData]) if (hasFavoritesList(src)) return extractFavoritesListFrom(src).map(toEntry);
  throw new Error("Couldn't read your collections from this page. Hard refresh and try again.");
}

async function viaDataRoute(execInTab, tabId, buildId, pathname) {
  let json;
  try { json = await execInTab(tabId, fetchDataRouteInPage, [buildId, pathname]); } catch { return null; }
  const found = findDesignListIn(json?.pageProps);
  return found ? mapDesignHits({ hits: withTitle(found.designs) }) : null;
}

/** -> { items, unreadable }. Data route (anchor path, then constructed path), then favorites API. */
export async function readCollectionItems(execInTab, tabId, entry) {
  const page = await readPage(execInTab, tabId);
  if (!page) return { items: [], unreadable: true };
  const { nextData, href } = page;
  const buildId = buildIdOf(nextData);
  const handle = extractHandle(nextData, href);
  let items = [];
  let routeFound = false;
  if (buildId) {
    let anchor = null;
    try {
      const hrefs = (await execInTab(tabId, collectAnchorPathnamesInPage, [])) || [];
      anchor = matchCollectionLinks(hrefs, [entry.listId]).get(String(entry.listId)) || null;
    } catch { /* constructed path only */ }
    const paths = [anchor, collectionDetailPathnameFrom(href, entry.listId, entry.slug)].filter(Boolean);
    for (const p of paths) {
      const got = await viaDataRoute(execInTab, tabId, buildId, p);
      if (got) { items = got; routeFound = true; break; }
    }
  }
  const count = typeof entry.count === 'number' ? entry.count : null;
  if (handle && (items.length === 0 || (count != null && items.length < count)) && !(routeFound && items.length === 0 && count === 0)) {
    let pages = [];
    try { pages = (await execInTab(tabId, fetchFavoritesInPage, [entry.listId, handle, itemOffsets(count)])) || []; } catch { /* none */ }
    const fb = pages.flatMap((p) => mapDesignHits(p));
    if (fb.length > items.length) items = fb;
  }
  return { items, unreadable: items.length === 0 && !routeFound };
}
