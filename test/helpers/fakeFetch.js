// Queue-based fetch fake. Each queued item is a response spec or an Error (rejects) or a function(url, init).
export function makeResponse({ status = 200, json, text, body, headers = {} } = {}) {
  const h = new Headers(headers);
  const textVal = text ?? (json !== undefined ? JSON.stringify(json) : '');
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: h,
    body: body ?? new Response(textVal).body,
    async json() { return json !== undefined ? json : JSON.parse(textVal); },
    async text() { return textVal; },
  };
}

export function createFakeFetch(queue = []) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (!queue.length) throw new Error(`fakeFetch: queue empty for ${url}`);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(url, init);
    return makeResponse(next);
  };
  fetchImpl.calls = calls;
  fetchImpl.queue = queue;
  fetchImpl.push = (...items) => queue.push(...items);
  return fetchImpl;
}
