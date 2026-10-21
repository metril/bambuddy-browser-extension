// Side-effect-free probe: can a streamed (no Content-Length) request body reach the app?
// POST /auth/status is GET-only, so an app that receives the stream answers 405.
// Returns "ok" | "blocked" | "h1".
export async function probeStreamUpload({ baseUrl, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
  const url = `${String(baseUrl || '').replace(/\/+$/, '')}/api/v1/auth/status`;
  const body = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('probe')); c.close(); },
  });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST', body, duplex: 'half', credentials: 'omit', signal: ctl.signal,
      headers: { 'X-API-Key': apiKey || '' },
    });
    const ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
    return res.status === 405 || /application\/json/i.test(ct) ? 'ok' : 'blocked';
  } catch (e) {
    return e instanceof TypeError ? 'h1' : 'blocked';
  } finally {
    clearTimeout(timer);
  }
}
