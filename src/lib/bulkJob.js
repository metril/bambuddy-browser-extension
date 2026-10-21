// Pure pool runner for bulk imports. No chrome, no network.
const THROTTLE_MS = 1000;

export function createBulkJob({ items, concurrency = 2, run, onUpdate, now = Date.now }) {
  const ac = new AbortController();
  const state = {
    status: 'running', total: items.length, done: 0, skipped: 0,
    failed: [], imported: [], startedAt: null, finishedAt: null,
  };
  let lastEmit = -Infinity;
  let started = null;

  const emit = (force) => {
    const t = now();
    if (!force && t - lastEmit < THROTTLE_MS) return;
    lastEmit = t;
    try { onUpdate?.(snapshot()); } catch { /* observers must not break the job */ }
  };
  const snapshot = () => ({ ...state, failed: [...state.failed], imported: [...state.imported] });

  function record(item, r) {
    state.done++;
    if (r?.outcome === 'imported') state.imported.push({ title: item.title, fileId: r.fileId ?? null });
    else if (r?.outcome === 'skipped') state.skipped++;
    else state.failed.push({ title: item.title, url: item.url, error: r?.error || 'Failed' });
  }

  async function worker(queue) {
    while (!ac.signal.aborted && queue.length) {
      const item = queue.shift();
      let r;
      try { r = await run(item, ac.signal); } catch (e) { r = { outcome: 'failed', error: String(e?.message || e) }; }
      record(item, r);
      emit(false);
    }
  }

  return {
    start() {
      if (started) return started;
      state.startedAt = now();
      emit(true);
      const queue = [...items];
      const n = Math.max(1, Math.min(Math.floor(concurrency) || 1, queue.length || 1));
      started = Promise.all(Array.from({ length: n }, () => worker(queue))).then(() => {
        state.status = ac.signal.aborted ? 'cancelled' : 'done';
        state.finishedAt = now();
        emit(true);
        return snapshot();
      });
      return started;
    },
    cancel() { ac.abort(); },
    get state() { return snapshot(); },
  };
}
