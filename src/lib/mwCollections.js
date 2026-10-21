// Pure, chrome-free parsers for MakerWorld collections page data
// (inline __NEXT_DATA__ or a /_next/data route response's pageProps).

const MAKERWORLD_HOSTS = new Set(['makerworld.com', 'www.makerworld.com']);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function parseNextData(text) {
  try {
    const v = JSON.parse(text ?? 'null');
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

export const buildIdOf = (nextData) => (typeof nextData?.buildId === 'string' && nextData.buildId ? nextData.buildId : null);

export const dataRouteUrl = (buildId, pathname) => `/_next/data/${buildId}${String(pathname).replace(/\/$/, '')}.json`;

function locateFavoritesList(src) {
  const pageProps = src?.props?.pageProps ?? src;
  const l = pageProps?.favoritesList;
  return Array.isArray(l) ? l : null;
}

export const hasFavoritesList = (src) => locateFavoritesList(src) !== null;

export function extractFavoritesListFrom(src) {
  const list = locateFavoritesList(src);
  if (!list) return [];
  const out = [];
  for (const item of list) {
    if (!item || !item.id || !item.title) continue;
    out.push({
      list_id: String(item.id),
      title: item.title,
      slug: item.slug ?? null,
      count: item.designCnt ?? null,
      is_default: Boolean(item.isDefault),
    });
  }
  return out;
}

const HANDLE_PATH_RE = /\/@([^/]+)\/collections(?:\/.*)?$/i;

export function extractHandle(nextData, url) {
  try {
    const m = HANDLE_PATH_RE.exec(new URL(url).pathname);
    if (m) return decodeURIComponent(m[1]);
  } catch { /* fall through */ }
  const pp = nextData?.props?.pageProps;
  const n = pp?.userInfo?.name ?? pp?.profile?.name ?? pp?.accountInfo?.name ?? null;
  return typeof n === 'string' && n ? n : null;
}

// Detail page: /{locale}/collections/{id}[-slug] (plural, no @handle).
const DETAIL_RE = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?collections\/(\d+)(?:-([^/?#]*))?\/?$/i;
// Anchors may also be singular, but only ids already known are accepted.
const ANCHOR_RE = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?collections?\/(\d+)(?:-([^/?#]*))?\/?$/i;

export function matchCollectionLinks(hrefs, listIds) {
  const ids = new Set((listIds || []).map(String));
  const result = new Map();
  for (const href of hrefs || []) {
    if (typeof href !== 'string' || !href) continue;
    let pathname;
    try {
      const u = new URL(href);
      if (!MAKERWORLD_HOSTS.has(u.hostname.toLowerCase())) continue;
      pathname = u.pathname;
    } catch {
      pathname = href.split('?')[0].split('#')[0];
    }
    const m = ANCHOR_RE.exec(pathname);
    if (!m || !ids.has(m[1]) || result.has(m[1])) continue;
    result.set(m[1], pathname.replace(/\/$/, ''));
  }
  return result;
}

export function parseCollectionDetailUrl(url) {
  try {
    const m = DETAIL_RE.exec(new URL(url).pathname);
    return m ? { id: m[1], slug: m[2] || null } : null;
  } catch {
    return null;
  }
}

function localeFromUrl(url) {
  try {
    const first = new URL(url).pathname.split('/').filter(Boolean)[0];
    return first && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(first) ? first.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function collectionDetailPathnameFrom(url, listId, slug) {
  const locale = localeFromUrl(url);
  const prefix = locale ? `/${locale}` : '';
  return slug ? `${prefix}/collections/${listId}-${encodeURIComponent(slug)}` : `${prefix}/collections/${listId}`;
}

const INFO_KEYS = ['favoritesInfo', 'collectionInfo', 'listInfo', 'info', 'detail'];

const looksLikeInfo = (v, id) => isObj(v) && typeof v.title === 'string' && !!v.title && String(v.id) === id;
const infoCount = (v) => (typeof v.designCnt === 'number' ? v.designCnt : typeof v.count === 'number' ? v.count : null);

export function findCollectionTitleIn(pageProps, id) {
  if (!isObj(pageProps) || !id) return null;
  for (const k of INFO_KEYS) {
    if (looksLikeInfo(pageProps[k], id)) return { title: pageProps[k].title, count: infoCount(pageProps[k]) };
  }
  for (const [k, v] of Object.entries(pageProps)) {
    if (INFO_KEYS.includes(k) || k === 'favoritesList') continue;
    if (looksLikeInfo(v, id)) return { title: v.title, count: infoCount(v) };
    if (isObj(v)) {
      for (const [nk, nv] of Object.entries(v)) {
        if (nk !== 'favoritesList' && looksLikeInfo(nv, id)) return { title: nv.title, count: infoCount(nv) };
      }
    }
  }
  return null;
}

export const MAX_ITEMS_PER_COLLECTION = 500;

/** Offsets for the favorites-API fallback, capped. */
export function itemOffsets(count, pageSize = 20) {
  const n = Math.min(typeof count === 'number' && count > 0 ? count : pageSize, MAX_ITEMS_PER_COLLECTION);
  return Array.from({ length: Math.max(1, Math.ceil(n / pageSize)) }, (_, i) => i * pageSize);
}

export function mapDesignHits(resp) {
  const hits = resp?.hits;
  if (!Array.isArray(hits)) return [];
  const items = [];
  for (const d of hits) {
    if (!d || !d.id || !(d.title || d.name)) continue;
    items.push({
      externalId: String(d.id),
      title: d.title || d.name,
      url: `https://makerworld.com/en/models/${d.id}`,
      author: d.designCreator?.name ?? null,
      thumbnailUrl: d.cover ?? null,
    });
  }
  return items;
}

const DESIGN_LIST_KEYS = ['designs', 'favoritesDesigns', 'list'];
const TRUSTED_EMPTY_KEYS = new Set(['designs', 'favoritesDesigns']);
const EXCLUDED_KEYS = new Set(['favoritesList']);

const looksLikeDesign = (v) =>
  isObj(v) && typeof v.id === 'number' && (typeof v.title === 'string' || typeof v.name === 'string') &&
  !('designCnt' in v || 'isDefault' in v);

const isDesignArray = (a) => a.length > 0 && a.some(looksLikeDesign) && a.every((x) => x === null || looksLikeDesign(x));

export function findDesignListIn(pageProps) {
  if (!isObj(pageProps)) return null;
  for (const key of DESIGN_LIST_KEYS) {
    const c = pageProps[key];
    if (!Array.isArray(c)) continue;
    if (c.length === 0) {
      if (TRUSTED_EMPTY_KEYS.has(key)) return { key, designs: c };
      continue;
    }
    if (isDesignArray(c)) return { key, designs: c };
  }
  for (const [key, v] of Object.entries(pageProps)) {
    if (EXCLUDED_KEYS.has(key) || DESIGN_LIST_KEYS.includes(key)) continue;
    if (Array.isArray(v) && isDesignArray(v)) return { key, designs: v };
    if (isObj(v)) {
      for (const [nk, nv] of Object.entries(v)) {
        if (!EXCLUDED_KEYS.has(nk) && Array.isArray(nv) && isDesignArray(nv)) return { key: `${key}.${nk}`, designs: nv };
      }
    }
  }
  return null;
}
