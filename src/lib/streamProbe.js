import { STREAM_ERR } from './api.js';

// Side-effect-free probe: can a streamed (no Content-Length) request body reach the app?
// POST /auth/status is GET-only, so an app that receives the stream answers 405.
// Returns "ok" | "blocked" | "h1" | "unknown" (unknown: do not persist, retry later).
// A timeout counts as blocked so auto mode does not re-probe on every save.
export async function probeStreamUpload({ baseUrl, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
  const url = `${String(baseUrl || '').replace(/\/+$/, '')}/api/v1/auth/status`;
  const body = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('probe')); c.close(); },
  });
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST', body, duplex: 'half', credentials: 'omit', signal: ctl.signal,
      headers: { 'X-API-Key': apiKey || '' },
    });
    return res.status === 405 || res.status === 401 ? 'ok' : 'blocked';
  } catch (e) {
    if (timedOut && e?.name === 'AbortError') return 'blocked'; // a proxy that stalls streamed bodies
    return e instanceof TypeError && STREAM_ERR.test(e.message) ? 'h1' : 'unknown';
  } finally {
    clearTimeout(timer);
  }
}
