import test from 'node:test';
import assert from 'node:assert/strict';
import { createBulkJob } from '../src/lib/bulkJob.js';

const items = (n) => Array.from({ length: n }, (_, i) => ({ title: `t${i}`, url: `u${i}` }));
const tick = () => new Promise((r) => setImmediate(r));

test('pool never exceeds concurrency and accounts outcomes', async () => {
  let active = 0, max = 0;
  const job = createBulkJob({
    items: items(9), concurrency: 3,
    run: async (it) => {
      active++; max = Math.max(max, active);
      await tick();
      active--;
      const n = Number(it.title.slice(1));
      if (n % 3 === 0) return { outcome: 'imported', fileId: n };
      if (n % 3 === 1) return { outcome: 'skipped' };
      if (n === 5) throw new Error('boom');
      return { outcome: 'failed', error: 'nope' };
    },
  });
  const s = await job.start();
  assert.equal(max, 3);
  assert.equal(s.status, 'done');
  assert.equal(s.done, 9);
  assert.equal(s.total, 9);
  assert.deepEqual(s.imported.map((x) => x.fileId), [0, 3, 6]);
  assert.equal(s.skipped, 3);
  assert.deepEqual(s.failed.map((f) => f.error).sort(), ['boom', 'nope', 'nope']);
  assert.deepEqual(s.failed[0].url?.startsWith('u'), true);
  assert.ok(s.finishedAt >= s.startedAt);
});

test('cancel mid-run aborts signal and stops dispatching', async () => {
  const seen = [];
  let signal;
  let job;
  job = createBulkJob({
    items: items(10), concurrency: 2,
    run: async (it, sig) => {
      signal = sig; seen.push(it.title);
      if (seen.length === 2) job.cancel();
      await tick();
      return { outcome: 'imported', fileId: 1 };
    },
  });
  const s = await job.start();
  assert.equal(s.status, 'cancelled');
  assert.equal(signal.aborted, true);
  assert.equal(seen.length, 2);
  assert.equal(s.done, 2);
});

test('onUpdate throttled to 1/s plus start and final', async () => {
  let t = 0;
  const calls = [];
  const job = createBulkJob({
    items: items(5), concurrency: 1, now: () => t,
    run: async () => { t += 300; return { outcome: 'imported' }; },
    onUpdate: (s) => calls.push({ done: s.done, status: s.status }),
  });
  await job.start();
  // t: start(0) emit; item done at 300,600,900 throttled; 1200 emits; 1500 throttled; final emits
  assert.deepEqual(calls, [{ done: 0, status: 'running' }, { done: 4, status: 'running' }, { done: 5, status: 'done' }]);
});

test('empty job finishes, throwing observer is tolerated', async () => {
  const s = await createBulkJob({ items: [], run: async () => ({}), onUpdate: () => { throw new Error('x'); } }).start();
  assert.equal(s.status, 'done');
  assert.equal(s.total, 0);
});
