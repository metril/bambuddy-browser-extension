// Pure, chrome-free URL detection for the supported sites.

export const SITES = {
  makerworld: {
    id: 'makerworld',
    label: 'MakerWorld',
    hosts: ['makerworld.com', 'www.makerworld.com'],
    hostPatterns: ['https://makerworld.com/*', 'https://www.makerworld.com/*'],
  },
  printables: {
    id: 'printables',
    label: 'Printables',
    hosts: ['printables.com', 'www.printables.com'],
    hostPatterns: [
      'https://www.printables.com/*',
      'https://printables.com/*',
      'https://api.printables.com/*',
      'https://media.printables.com/*',
      'https://files.printables.com/*',
    ],
  },
  thingiverse: {
    id: 'thingiverse',
    label: 'Thingiverse',
    hosts: ['thingiverse.com', 'www.thingiverse.com'],
    hostPatterns: [
      'https://www.thingiverse.com/*',
      'https://thingiverse.com/*',
      'https://api.thingiverse.com/*',
      'https://cdn.thingiverse.com/*',
    ],
  },
};

/** Single source for context-menu URL patterns (equals manifest host_permissions). */
export const HOST_PATTERNS = Object.values(SITES).flatMap((s) => s.hostPatterns);

// BCP-47-ish locale prefix: en, pt-br, en-US, zh-hans.
const LOCALE_SRC = '[a-z]{2}(?:-[a-z0-9]{2,4})*';
const LOCALE = `(?:${LOCALE_SRC}\\/)?`;
const MODEL_PATHS = {
  makerworld: new RegExp(`^\\/${LOCALE}models\\/(\\d+)(?:-[^/?#]*)?\\/?$`, 'i'),
  printables: new RegExp(`^\\/${LOCALE}model\\/(\\d+)(?:-[^/?#]*)?\\/?$`, 'i'),
  thingiverse: /^\/thing:(\d+)(?:\/.*)?$/i,
};
const COLLECTIONS_PATH = new RegExp(`^\\/${LOCALE}@[^/]+\\/collections(?:\\/.*)?$`, 'i');
// Plural-only on purpose: never tolerate a singular "/collection/{id}".
const COLLECTION_DETAIL_PATH = new RegExp(`^\\/${LOCALE}collections\\/(\\d+)(?:-[^/?#]*)?\\/?$`, 'i');

function parse(url) {
  try {
    return url instanceof URL ? url : new URL(url);
  } catch {
    return null;
  }
}

export function detectSite(url) {
  const u = parse(url);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  for (const s of Object.values(SITES)) if (s.hosts.includes(host)) return s.id;
  return null;
}

export function isModelPage(url) {
  const u = parse(url);
  const site = u && detectSite(u);
  if (!site) return null;
  const m = MODEL_PATHS[site].exec(u.pathname);
  return m ? { site, id: m[1] } : null;
}

export function isCollectionsPage(url) {
  const u = parse(url);
  return !!u && detectSite(u) === 'makerworld' && COLLECTIONS_PATH.test(u.pathname);
}

export function isCollectionDetailPage(url) {
  const u = parse(url);
  return !!u && detectSite(u) === 'makerworld' && COLLECTION_DETAIL_PATH.test(u.pathname);
}
