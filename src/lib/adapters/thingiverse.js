// Thingiverse adapter: page scrape in the tab + Cloudflare-tolerant download strategy chain.
import { sanitizeFilename } from '../filenames.js';

export const CF_ERROR = 'Thingiverse blocked the download (Cloudflare). Open the Thing page, wait for it to load fully, then try again. If it keeps failing, sign in to Thingiverse.';

export function parseThingId(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  const m = /\/thing:(\d+)/i.exec(u.pathname);
  return m ? m[1] : null;
}

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const FILE_TOKEN = /[^\s"'<>]+\.(?:3mf|stl|step|stp|obj|zip)\b/i;
const EXT_END = /\.(?:3mf|stl|step|stp|obj|zip)$/i;
// Prefer the whole hint when it ends in an allowed extension ("Base v2.stl"); otherwise find a token inside it.
const fileName = (t) => {
  const h = String(t || '').trim();
  if (EXT_END.test(h)) return h;
  const m = FILE_TOKEN.exec(h);
  return m ? m[0] : null;
};
const TITLE_SUFFIX = /\s+by\s+(.+?)\s+-\s+Thingiverse\s*$/i;

export function parsePageMeta(pageData) {
  const pd = pageData || {};
  const ld = (pd.jsonLd || []).flatMap((o) => (Array.isArray(o) ? o : o && Array.isArray(o['@graph']) ? o['@graph'] : [o])).filter(Boolean);
  const pick = (f) => { for (const o of ld) { const v = f(o); if (v) return v; } return null; };
  const docTitle = str(pd.title);
  const tm = docTitle ? TITLE_SUFFIX.exec(docTitle) : null;
  const title = pick((o) => str(o.name)) || str(pd.og?.title) || (docTitle ? docTitle.replace(TITLE_SUFFIX, '').replace(/\s+-\s+Thingiverse\s*$/i, '').trim() : '') || '';
  const designer = pick((o) => str(o.author?.name) || str(o.creator?.name)) || (tm ? tm[1].trim() : null);
  const thumbnailUrl = pick((o) => str(Array.isArray(o.image) ? o.image[0] : o.image)) || str(pd.og?.image) || null;
  const files = [];
  const seen = new Set();
  for (const l of pd.fileLinks || []) {
    const m = /\/download:(\d+)/.exec(l?.href || '');
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const tok = [...(l.hints || []), l.text].map(fileName).find(Boolean);
    const f = { id: m[1], name: tok || `file-${m[1]}`, url: `https://www.thingiverse.com/download:${m[1]}` };
    if (!tok) f.deriveName = true;
    files.push(f);
  }
  return { title, designer, thumbnailUrl, files };
}

// Runs inside the page via execInTab: must stay self-contained (no imports/closures).
export function readPageInTab() {
  const jsonLd = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { jsonLd.push(JSON.parse(s.textContent)); } catch { /* ignore */ }
  }
  const og = {};
  for (const m of document.querySelectorAll('meta[property^="og:"]')) {
    og[m.getAttribute('property').slice(3)] = m.getAttribute('content');
  }
  const fileLinks = [];
  for (const a of document.querySelectorAll('a[href*="/download:"]')) {
    const hints = ['data-filename', 'download', 'title', 'aria-label'].map((k) => a.getAttribute(k)).filter(Boolean);
    fileLinks.push({ href: a.href || a.getAttribute('href'), text: (a.getAttribute('data-filename') || a.textContent || '').trim(), hints });
  }
  return { title: document.title, jsonLd, og, fileLinks };
}

export function looksLikeHtml(contentType, firstBytes) {
  if (/text\/html/i.test(String(contentType || ''))) return true;
  if (firstBytes != null) {
    const s = typeof firstBytes === 'string' ? firstBytes : new TextDecoder().decode(firstBytes.subarray ? firstBytes.subarray(0, 64) : firstBytes);
    return /^\s*<(!doctype|html)/i.test(s);
  }
  return false;
}

export async function fetchThingiverseModel(url, { fetchImpl = globalThis.fetch, pageData } = {}) {
  const id = parseThingId(url);
  if (!id) throw new Error('Not a Thingiverse Thing URL');
  const pm = parsePageMeta(pageData);
  const title = pm.title || `thingiverse-${id}`;
  const meta = { title, designer: pm.designer || '', site: 'thingiverse', pageUrl: url, thumbnailUrl: pm.thumbnailUrl || '' };

  const zipUrl = `https://www.thingiverse.com/thing:${id}/zip`;
  try {
    const res = await fetchImpl(zipUrl, { method: 'GET', credentials: 'include', redirect: 'follow' });
    const ct = res?.headers?.get?.('content-type');
    let ok = !!res?.ok && !looksLikeHtml(ct);
    if (ok && !ct) {
      // No content-type: only accept if the first chunk carries the zip magic.
      let first = null;
      try { first = (await res.body?.getReader?.().read())?.value; } catch { /* ignore */ }
      ok = !!first && first[0] === 0x50 && first[1] === 0x4b && first[2] === 3 && first[3] === 4;
    }
    try { await res?.body?.cancel(); } catch { /* ignore */ }
    if (ok) return { meta, files: [{ url: zipUrl, filename: sanitizeFilename(`${title}.zip`), kind: 'zip' }], strategy: 'zip' };
  } catch { /* fall through to links */ }

  if (pm.files.length) {
    return { meta, files: pm.files.map((f) => ({ url: f.url, filename: sanitizeFilename(f.name), ...(f.deriveName ? { deriveName: true } : {}) })), strategy: 'links' };
  }
  throw new Error(CF_ERROR);
}
