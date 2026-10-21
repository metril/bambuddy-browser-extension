import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFilename, classifyFile, isUploadable, buildNotes, folderNameFromTitle } from '../src/lib/filenames.js';

test('sanitizeFilename replaces illegal chars, collapses space, trims dots', () => {
  assert.equal(sanitizeFilename('  a<b>:c"/d\\e|f?g*h\u0001.3mf  '), 'a_b__c__d_e_f_g_h_.3mf');
  assert.equal(sanitizeFilename('my   model.stl'), 'my model.stl');
  assert.equal(sanitizeFilename('..name..'), 'name');
});
test('sanitizeFilename avoids reserved names', () => {
  assert.equal(sanitizeFilename('CON.stl'), '_CON.stl');
  assert.equal(sanitizeFilename('lpt3.3mf'), '_lpt3.3mf');
  assert.equal(sanitizeFilename('console.stl'), 'console.stl');
});
test('sanitizeFilename truncates stem, keeps extension', () => {
  const out = sanitizeFilename('x'.repeat(300) + '.gcode.3mf', { maxLength: 50 });
  assert.equal(out.length, 50);
  assert.ok(out.endsWith('.3mf'));
});
test('classifyFile', () => {
  assert.equal(classifyFile('A.3MF'), '3mf');
  assert.equal(classifyFile('a.STL'), 'stl');
  assert.equal(classifyFile('a.zip'), 'zip');
  assert.equal(classifyFile('a.gcode.3mf'), 'gcode3mf');
  assert.equal(classifyFile('a.gcode'), 'unsupported');
  assert.equal(classifyFile('a.bgcode'), 'unsupported');
  assert.equal(isUploadable('a.stl'), true);
  assert.equal(isUploadable('a.txt'), false);
});
test('buildNotes', () => {
  assert.equal(
    buildNotes({ title: 'Box', designer: 'Ann', site: 'printables', url: 'https://x/y', license: 'CC-BY' }),
    'Box by Ann — imported from Printables\nhttps://x/y\nLicense: CC-BY',
  );
  assert.equal(buildNotes({ title: 'Box', site: 'makerworld' }), 'Box — imported from MakerWorld');
  assert.equal(buildNotes({ url: 'https://x' }), 'https://x');
});
test('folderNameFromTitle', () => {
  assert.equal(folderNameFromTitle('A/B'), 'A_B');
  assert.equal(folderNameFromTitle('   '), 'Imported');
  assert.equal(folderNameFromTitle(undefined), 'Imported');
  assert.equal(folderNameFromTitle('y'.repeat(200)).length, 80);
});
