import test from 'node:test';
import assert from 'node:assert/strict';
import { parseThingId, parsePageMeta, readPageInTab, looksLikeHtml, fetchThingiverseModel } from '../src/lib/adapters/thingiverse.js';

test('parseThingId', () => {
  assert.equal(parseThingId('https://www.thingiverse.com/thing:763622'), '763622');
  assert.equal(parseThingId('https://www.thingiverse.com/thing:763622/files'), '763622');
  assert.equal(parseThingId('https://www.thingiverse.com/'), null);
  assert.equal(parseThingId('nope'), null);
});

const links = [
  { href: 'https://www.thingiverse.com/download:11', text: 'a.stl' },
  { href: '/download:11', text: 'dup.stl' },
  { href: '/download:12', text: 'Download' },
  { href: '/download:13', text: 'Download', hints: ['x', 'Model 2.3mf'] },
];

test('parsePageMeta: JSON-LD wins, dedupes links', () => {
  const m = parsePageMeta({
    title: 'X by Y - Thingiverse',
    jsonLd: [{ name: 'Benchy', author: { name: 'Cr' }, image: ['https://i/1.jpg', 'https://i/2.jpg'] }],
    og: { title: 'og', image: 'https://og.jpg' },
    fileLinks: links,
  });
  assert.equal(m.title, 'Benchy');
  assert.equal(m.designer, 'Cr');
  assert.equal(m.thumbnailUrl, 'https://i/1.jpg');
  assert.deepEqual(m.files, [
    { id: '11', name: 'a.stl', url: 'https://www.thingiverse.com/download:11' },
    { id: '12', name: 'file-12', url: 'https://www.thingiverse.com/download:12', deriveName: true },
    { id: '13', name: '2.3mf', url: 'https://www.thingiverse.com/download:13' },
  ]);
});

test('parsePageMeta: og only and title only', () => {
  const og = parsePageMeta({ title: 'T by D - Thingiverse', jsonLd: [], og: { title: 'OG', image: 'https://og.jpg' }, fileLinks: [] });
  assert.deepEqual([og.title, og.designer, og.thumbnailUrl], ['OG', 'D', 'https://og.jpg']);
  const t = parsePageMeta({ title: 'Cool Thing by Dee - Thingiverse' });
  assert.deepEqual([t.title, t.designer, t.thumbnailUrl, t.files], ['Cool Thing', 'Dee', null, []]);
});

test('readPageInTab with fake document', () => {
  const prev = globalThis.document;
  globalThis.document = {
    title: 'T',
    querySelectorAll: (sel) => ({
      'script[type="application/ld+json"]': [{ textContent: '{"name":"n"}' }, { textContent: '{bad' }],
      'meta[property^="og:"]': [{ getAttribute: (k) => (k === 'property' ? 'og:title' : 'OG') }],
      'a[href*="/download:"]': [{ href: 'https://www.thingiverse.com/download:5', getAttribute: (k) => ({ 'data-filename': 'f.stl', title: 'Get f.stl' })[k] ?? null, textContent: ' x ' }],
    })[sel],
  };
  try {
    assert.deepEqual(readPageInTab(), {
      title: 'T', jsonLd: [{ name: 'n' }], og: { title: 'OG' },
      fileLinks: [{ href: 'https://www.thingiverse.com/download:5', text: 'f.stl', hints: ['f.stl', 'Get f.stl'] }],
    });
  } finally { globalThis.document = prev; }
});

test('looksLikeHtml', () => {
  assert.equal(looksLikeHtml('text/html; charset=utf-8'), true);
  assert.equal(looksLikeHtml('application/zip', '<!DOCTYPE html>'), true);
  assert.equal(looksLikeHtml('application/zip', ' <html>'), true);
  assert.equal(looksLikeHtml('application/zip'), false);
});

const U = 'https://www.thingiverse.com/thing:5';
function fakeFetch(ct, ok = true) {
  const st = { cancelled: false, calls: [] };
  const f = async (url, init) => {
    st.calls.push([url, init]);
    return { ok, status: ok ? 200 : 403, headers: new Headers({ 'content-type': ct }), body: { cancel: async () => { st.cancelled = true; } } };
  };
  return { f, st };
}

test('fetchThingiverseModel: zip strategy cancels body', async () => {
  const { f, st } = fakeFetch('application/zip');
  const r = await fetchThingiverseModel(U, { fetchImpl: f, pageData: { title: 'Benchy by Cr - Thingiverse' } });
  assert.equal(r.strategy, 'zip');
  assert.deepEqual(r.files, [{ url: `${U}/zip`, filename: 'Benchy.zip', kind: 'zip' }]);
  assert.equal(r.meta.site, 'thingiverse');
  assert.equal(r.meta.designer, 'Cr');
  assert.equal(st.cancelled, true);
  assert.equal(st.calls[0][1].credentials, 'include');
});

test('fetchThingiverseModel: HTML + links -> links strategy', async () => {
  const { f } = fakeFetch('text/html');
  const r = await fetchThingiverseModel(U, { fetchImpl: f, pageData: { title: 'B', fileLinks: links } });
  assert.equal(r.strategy, 'links');
  assert.deepEqual(r.files.map((x) => x.url), ['https://www.thingiverse.com/download:11', 'https://www.thingiverse.com/download:12', 'https://www.thingiverse.com/download:13']);
});

test('fetchThingiverseModel: HTML + no links throws Cloudflare message', async () => {
  const { f, st } = fakeFetch('text/html', false);
  await assert.rejects(fetchThingiverseModel(U, { fetchImpl: f, pageData: { fileLinks: [] } }), /Cloudflare/);
  assert.equal(st.cancelled, true);
  await assert.rejects(fetchThingiverseModel(U, { fetchImpl: async () => { throw new Error('net'); } }), /Cloudflare/);
});

test('zip probe: missing content-type needs PK magic', async () => {
  const mk = (bytes) => async () => ({ ok: true, status: 200, headers: new Headers(), body: new Response(new Uint8Array(bytes)).body });
  const z = await fetchThingiverseModel(U, { fetchImpl: mk([0x50, 0x4b, 3, 4, 9]), pageData: { fileLinks: [] } });
  assert.equal(z.strategy, 'zip');
  await assert.rejects(fetchThingiverseModel(U, { fetchImpl: mk([60, 33, 68]), pageData: { fileLinks: [] } }), /Cloudflare/);
});
