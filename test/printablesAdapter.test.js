import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseModelId, buildPrintQuery, buildDownloadMutation, parsePrint, selectFiles, fileTypeForGroup, fetchPrintablesModel,
} from '../src/lib/adapters/printables.js';
import { createFakeFetch } from './helpers/fakeFetch.js';

const printJson = (over = {}) => ({
  data: {
    print: {
      id: '3161', name: 'Benchy', premium: false, user: { publicUsername: 'creality' },
      image: { filePath: 'media/prints/3161/img.jpg' }, license: { name: 'CC BY' },
      stls: [{ id: '1', name: 'boat.stl', fileSize: 100 }],
      gcodes: [{ id: '2', name: 'boat.gcode', fileSize: 5 }, { id: '3', name: 'boat.gcode.3mf', fileSize: 6 }],
      otherFiles: [{ id: '4', name: 'proj.3mf', fileSize: 7 }, { id: '5', name: 'readme.pdf', fileSize: 1 }, { id: '6', name: 'x.gcode.3mf', fileSize: 1 }],
      ...over,
    },
  },
});

test('parseModelId', () => {
  assert.equal(parseModelId('https://www.printables.com/model/3161-3dbenchy'), '3161');
  assert.equal(parseModelId('https://www.printables.com/de/model/3161-x/'), '3161');
  assert.equal(parseModelId('https://www.printables.com/model/3161'), '3161');
  assert.equal(parseModelId('https://www.printables.com/@user'), null);
  assert.equal(parseModelId('nope'), null);
});

test('query/mutation bodies', () => {
  assert.deepEqual(buildPrintQuery(7).variables, { id: '7' });
  assert.match(buildPrintQuery(7).query, /stls\{id name fileSize\}/);
  assert.doesNotMatch(buildPrintQuery(7).query, /images/);
  assert.deepEqual(buildDownloadMutation(7, 'stl', 9).variables, { printId: '7', files: [{ fileType: 'stl', ids: ['9'] }], source: 'model_detail' });
  assert.equal(fileTypeForGroup('gcode'), 'gcode');
  assert.equal(fileTypeForGroup('other'), 'other');
  assert.equal(fileTypeForGroup('stl'), 'stl');
});

test('parsePrint', () => {
  const p = parsePrint(printJson());
  assert.equal(p.title, 'Benchy');
  assert.equal(p.designer, 'creality');
  assert.equal(p.license, 'CC BY');
  assert.equal(p.thumbnailUrl, 'https://media.printables.com/media/prints/3161/img.jpg');
  assert.equal(p.files.length, 6);
  assert.deepEqual(p.files[0], { id: '1', name: 'boat.stl', size: 100, group: 'stl' });
  const bare = parsePrint(printJson({ image: null, license: null, user: null, premium: true, stls: null, gcodes: undefined, otherFiles: [] }));
  assert.equal(bare.thumbnailUrl, '');
  assert.equal(bare.license, '');
  assert.equal(bare.premium, true);
  assert.deepEqual(bare.files, []);
});

test('parsePrint throws on errors / missing print', () => {
  assert.throws(() => parsePrint({ errors: [{ message: 'bad field' }] }), /bad field/);
  assert.throws(() => parsePrint({ data: { print: null } }), /not found/);
  assert.throws(() => parsePrint(null), /not found/);
});

test('selectFiles rules', () => {
  const names = selectFiles(parsePrint(printJson())).map((f) => f.name);
  assert.deepEqual(names, ['boat.stl', 'boat.gcode.3mf', 'proj.3mf']);
  // gcode.3mf in "other" is not a 3mf/stl kind -> dropped
  assert.deepEqual(selectFiles({ files: [{ name: 'a.gcode', group: 'gcode' }, { name: 'a.zip', group: 'stl' }] }), []);
});

const link = (l) => ({ json: { data: { getDownloadLink: { ok: true, errors: null, output: { link: l } } } } });

test('fetchPrintablesModel resolves links sequentially', async () => {
  const f = createFakeFetch([{ json: printJson() }, link('https://files/a'), link('https://files/b'), link('https://files/c')]);
  const m = await fetchPrintablesModel('https://www.printables.com/model/3161-x', { fetchImpl: f });
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls[0].url, 'https://api.printables.com/graphql/');
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].init.credentials, 'include');
  const bodies = f.calls.slice(1).map((c) => JSON.parse(c.init.body).variables.files[0]);
  assert.deepEqual(bodies, [{ fileType: 'stl', ids: ['1'] }, { fileType: 'gcode', ids: ['3'] }, { fileType: 'other', ids: ['4'] }]);
  assert.deepEqual(m.files.map((x) => x.url), ['https://files/a', 'https://files/b', 'https://files/c']);
  assert.equal(m.files[0].filename, 'boat.stl');
  assert.equal(m.files[0].sizeHint, 100);
  assert.equal(m.meta.site, 'printables');
  assert.equal(m.meta.pageUrl, 'https://www.printables.com/model/3161-x');
  assert.equal(m.meta.license, 'CC BY');
});

test('fetchPrintablesModel premium throws before link calls', async () => {
  const f = createFakeFetch([{ json: printJson({ premium: true }) }]);
  await assert.rejects(fetchPrintablesModel('https://www.printables.com/model/1-x', { fetchImpl: f }), /Club \/ paid model/);
  assert.equal(f.calls.length, 1);
});

test('fetchPrintablesModel graphql errors throw', async () => {
  await assert.rejects(fetchPrintablesModel('https://www.printables.com/model/1-x', { fetchImpl: createFakeFetch([{ json: { errors: [{ message: 'nope' }] } }]) }), /nope/);
  const f = createFakeFetch([{ json: printJson() }, { json: { errors: [{ message: 'link boom' }] } }]);
  await assert.rejects(fetchPrintablesModel('https://www.printables.com/model/1-x', { fetchImpl: f }), /link boom/);
  const g = createFakeFetch([{ json: printJson() }, { json: { data: { getDownloadLink: { ok: false, errors: [{ messages: ['denied'] }], output: null } } } }]);
  await assert.rejects(fetchPrintablesModel('https://www.printables.com/model/1-x', { fetchImpl: g }), /denied/);
  await assert.rejects(fetchPrintablesModel('https://example.com', { fetchImpl: f }), /Not a Printables/);
});
