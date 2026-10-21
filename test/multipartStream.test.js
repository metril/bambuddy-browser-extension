import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoundary, buildMultipartStream, countingTransform } from '../src/lib/multipartStream.js';

const enc = new TextEncoder();
const streamOf = (chunks) => new ReadableStream({
  start(c) { for (const x of chunks) c.enqueue(x); c.close(); },
});
async function collect(stream) {
  const out = [];
  for await (const c of stream) out.push(c);
  return out;
}
const concat = (chunks) => Buffer.concat(chunks.map((c) => Buffer.from(c)));

test('createBoundary format', () => {
  assert.match(createBoundary(), /^----BambuddyExt[A-Za-z0-9]{24}$/);
  assert.notEqual(createBoundary(), createBoundary());
});

test('multipart round-trips preamble, body, epilogue; body not buffered', async () => {
  const parts = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6, 250, 255])];
  const { stream, boundary } = buildMultipartStream({
    field: 'file', filename: 'a"b.3mf', body: streamOf(parts), boundary: 'BND',
  });
  assert.equal(boundary, 'BND');
  const chunks = await collect(stream);
  assert.ok(chunks.length >= 3 + 2);
  const all = concat(chunks);
  const pre = enc.encode('--BND\r\nContent-Disposition: form-data; name="file"; filename="a%22b.3mf"\r\nContent-Type: application/octet-stream\r\n\r\n');
  const post = enc.encode('\r\n--BND--\r\n');
  assert.deepEqual([...all.subarray(0, pre.length)], [...pre]);
  assert.deepEqual([...all.subarray(all.length - post.length)], [...post]);
  assert.deepEqual([...all.subarray(pre.length, all.length - post.length)], [1, 2, 3, 4, 5, 6, 250, 255]);
});

test('countingTransform reports running totals', async () => {
  const seen = [];
  const out = streamOf([new Uint8Array(3), new Uint8Array(4)]).pipeThrough(countingTransform((n) => seen.push(n)));
  const chunks = await collect(out);
  assert.equal(chunks.length, 2);
  assert.deepEqual(seen, [3, 7]);
});

test('multipart works with a boundary default and cancel propagates', async () => {
  let cancelled = false;
  const body = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
  const { stream } = buildMultipartStream({ field: 'f', filename: 'x', body });
  const r = stream.getReader();
  await r.read(); await r.read();
  await r.cancel();
  assert.ok(cancelled);
});
