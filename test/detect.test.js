import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SITES, HOST_PATTERNS, detectSite, isModelPage, isCollectionsPage, isCollectionDetailPage } from '../src/lib/detect.js';

test('HOST_PATTERNS equals manifest host_permissions', () => {
  const m = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(new Set(HOST_PATTERNS), new Set(m.host_permissions));
  assert.equal(HOST_PATTERNS.length, new Set(HOST_PATTERNS).size);
  assert.deepEqual(Object.keys(SITES), ['makerworld', 'printables', 'thingiverse']);
});

test('isModelPage accepts BCP-47 locale prefixes', () => {
  assert.deepEqual(isModelPage('https://makerworld.com/zh-hans/models/123'), { site: 'makerworld', id: '123' });
  assert.deepEqual(isModelPage('https://makerworld.com/pt-br/models/123-x'), { site: 'makerworld', id: '123' });
  assert.deepEqual(isModelPage('https://www.printables.com/en-US/model/9-x'), { site: 'printables', id: '9' });
  assert.equal(isModelPage('https://makerworld.com/toolong/models/123'), null);
  assert.equal(isCollectionsPage('https://makerworld.com/zh-hant/@bob/collections'), true);
  assert.equal(isCollectionDetailPage('https://makerworld.com/zh-hans/collections/5-x'), true);
});

test('detectSite', () => {
  assert.equal(detectSite('https://www.makerworld.com/en/models/1'), 'makerworld');
  assert.equal(detectSite('https://printables.com/model/1'), 'printables');
  assert.equal(detectSite(new URL('https://WWW.Thingiverse.com/thing:1')), 'thingiverse');
  assert.equal(detectSite('https://example.com/'), null);
  assert.equal(detectSite('not a url'), null);
  assert.equal(detectSite(undefined), null);
});

test('isModelPage positives', () => {
  assert.deepEqual(isModelPage('https://makerworld.com/en/models/643408-foo'), { site: 'makerworld', id: '643408' });
  assert.deepEqual(isModelPage('https://makerworld.com/models/643408'), { site: 'makerworld', id: '643408' });
  assert.deepEqual(isModelPage('https://www.printables.com/model/12345-foo'), { site: 'printables', id: '12345' });
  assert.deepEqual(isModelPage('https://printables.com/model/12345'), { site: 'printables', id: '12345' });
  assert.deepEqual(isModelPage('https://www.printables.com/de/model/12345-foo'), { site: 'printables', id: '12345' });
  assert.deepEqual(isModelPage('https://www.thingiverse.com/thing:4990415'), { site: 'thingiverse', id: '4990415' });
  assert.deepEqual(isModelPage('https://www.thingiverse.com/thing:4990415/files'), { site: 'thingiverse', id: '4990415' });
});

test('isModelPage negatives', () => {
  for (const u of [
    'https://makerworld.com/en', 'https://makerworld.com/en/search?keyword=vase',
    'https://www.printables.com/model', 'https://www.printables.com/search/models?q=v',
    'https://www.thingiverse.com/explore/popular', 'https://example.com/models/1',
    'not a url', '', undefined,
  ]) assert.equal(isModelPage(u), null, String(u));
});

test('isCollectionsPage', () => {
  assert.equal(isCollectionsPage('https://makerworld.com/@Foo/collections'), true);
  assert.equal(isCollectionsPage('https://www.makerworld.com/en/@Foo/collections/1793275-trays'), true);
  assert.equal(isCollectionsPage('https://makerworld.com/en/@Foo/collections?tab=likes'), true);
  assert.equal(isCollectionsPage('https://makerworld.com/en/models/1-foo'), false);
  assert.equal(isCollectionsPage('https://makerworld.com/@Foo'), false);
  assert.equal(isCollectionsPage('https://www.thingiverse.com/@Foo/collections'), false);
  assert.equal(isCollectionsPage('not a url'), false);
  assert.equal(isCollectionsPage(undefined), false);
});

test('isCollectionDetailPage', () => {
  assert.equal(isCollectionDetailPage('https://makerworld.com/en/collections/18925823-esp32'), true);
  assert.equal(isCollectionDetailPage('https://makerworld.com/collections/18925823/'), true);
  assert.equal(isCollectionDetailPage('https://makerworld.com/en-us/collections/18925823-esp32'), true);
  assert.equal(isCollectionDetailPage('https://makerworld.com/en/collection/18925823-esp32'), false);
  assert.equal(isCollectionDetailPage('https://makerworld.com/en/@Foo/collections/18925823'), false);
  assert.equal(isCollectionDetailPage('https://makerworld.com/collections/'), false);
  assert.equal(isCollectionDetailPage('https://www.thingiverse.com/collections/1-x'), false);
  assert.equal(isCollectionDetailPage(undefined), false);
});
