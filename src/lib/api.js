// Bambuddy API client. Never throws: every call resolves to
// { ok, status, data, error, kind } with kind in auth|notfound|client|server|network.

const STREAM_ERR = /stream|body|http\/?[123]|http-1|failed to fetch/i;

function kindFor(status) {
  if (status === 0) return 'network';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'notfound';
  if (status >= 500) return 'server';
  return 'client';
}

function detailText(data, fallback) {
  const d = data && typeof data === 'object' ? data.detail : undefined;
  if (typeof d === 'string' && d) return d;
  if (Array.isArray(d)) {
    const msgs = d.map((x) => (typeof x === 'string' ? x : x && x.msg)).filter(Boolean);
    if (msgs.length) return msgs.join('; ');
  }
  return fallback;
}

export function createClient({
  baseUrl,
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
  uploadTimeoutMs = 120000,
} = {}) {
  const root = String(baseUrl || '').replace(/\/+$/, '');

  const redact = (s) => {
    let out = String(s ?? '');
    if (apiKey) out = out.split(apiKey).join('[redacted]');
    return out;
  };

  function buildUrl(path, query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) qs.append(k, String(v));
    const s = qs.toString();
    return `${root}/api/v1${path}${s ? `?${s}` : ''}`;
  }

  async function send(method, path, { query, headers = {}, body, duplex, signal, timeout }) {
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeout);
    const onAbort = () => ctl.abort();
    if (signal) {
      if (signal.aborted) ctl.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const init = {
        method,
        headers: { ...(apiKey ? { 'X-API-Key': apiKey } : {}), Accept: 'application/json', ...headers },
        credentials: 'omit',
        signal: ctl.signal,
      };
      if (body !== undefined) init.body = body;
      if (duplex) init.duplex = duplex;
      let res;
      try {
        res = await fetchImpl(buildUrl(path, query), init);
      } catch (e) {
        const error = timedOut ? 'Timed out' : redact(e && e.message) || 'Network error';
        return { ok: false, status: 0, data: null, error, kind: 'network', _cause: e };
      }
      let data = null;
      try {
        const text = await res.text();
        if (text) {
          try { data = JSON.parse(text); } catch { data = text; }
        }
      } catch {
        if (timedOut) return { ok: false, status: 0, data: null, error: 'Timed out', kind: 'network' };
      }
      if (res.ok) return { ok: true, status: res.status, data, error: null, kind: null };
      const error = redact(detailText(data, res.statusText || `HTTP ${res.status}`));
      return { ok: false, status: res.status, data, error, kind: kindFor(res.status) };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  const clean = ({ _cause, ...r }) => r;

  async function request(method, path, { body, query, signal } = {}) {
    const headers = {};
    let payload;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    return clean(await send(method, path, { query, headers, body: payload, signal, timeout: timeoutMs }));
  }

  async function upload(path, { field = 'file', blob, filename }, query, signal) {
    const fd = new FormData();
    fd.append(field, blob, filename);
    return clean(await send('POST', path, { query, body: fd, signal, timeout: uploadTimeoutMs }));
  }

  async function uploadStream(path, { stream, boundary }, query, signal) {
    const r = await send('POST', path, {
      query,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: stream,
      duplex: 'half',
      signal,
      timeout: uploadTimeoutMs,
    });
    if (r.kind === 'network' && r._cause instanceof TypeError && STREAM_ERR.test(r._cause.message)) {
      r.streamUnsupported = true;
    }
    return clean(r);
  }

  const zipQuery = ({ folderId, createFolderFromZip = false, preserveStructure = true, generateStlThumbnails = true } = {}) => ({
    folder_id: folderId,
    preserve_structure: preserveStructure,
    create_folder_from_zip: createFolderFromZip,
    generate_stl_thumbnails: generateStlThumbnails,
  });

  return {
    request,
    upload,
    uploadStream,
    authStatus: () => request('GET', '/auth/status'),
    mwStatus: () => request('GET', '/makerworld/status'),
    mwResolve: (url, { signal } = {}) => request('POST', '/makerworld/resolve', { body: { url }, signal }),
    mwImport: ({ model_id, profile_id, instance_id, folder_id }, { signal } = {}) =>
      request('POST', '/makerworld/import', {
        body: { source_type: 'makerworld', model_id, profile_id, instance_id, folder_id },
        signal,
      }),
    mwRecent: (limit) => request('GET', '/makerworld/recent-imports', { query: { limit } }),
    uploadFile: (blob, filename, { folderId, generateStlThumbnails } = {}) =>
      upload('/library/files', { field: 'file', blob, filename }, {
        folder_id: folderId,
        generate_stl_thumbnails: generateStlThumbnails,
      }),
    // parts: { field, filename, contentType, stream, boundary } (built by multipartStream.js)
    uploadFileStream: (parts, { folderId } = {}) =>
      uploadStream('/library/files', parts, { folder_id: folderId }),
    // Multipart zip upload; returns { extracted, folders_created, files[], errors[] }.
    extractZip: (blob, filename, opts) =>
      upload('/library/files/extract-zip', { field: 'file', blob, filename }, zipQuery(opts)),
    extractZipStream: (parts, opts) => uploadStream('/library/files/extract-zip', parts, zipQuery(opts)),
    updateFile: (id, patch) => request('PUT', `/library/files/${encodeURIComponent(id)}`, { body: patch }),
    setThumbnail: (id, blob, filename) =>
      upload(`/library/files/${encodeURIComponent(id)}/preview-thumbnail`, { field: 'thumbnail', blob, filename }),
    listFolders: () => request('GET', '/library/folders'),
    createFolder: (name, parentId) =>
      request('POST', '/library/folders', { body: { name, parent_id: parentId } }),
    listTags: () => request('GET', '/library/tags'),
    createTag: (name) => request('POST', '/library/tags', { body: { name } }),
    bulkAssignTags: (fileIds, tagIds, action = 'add') =>
      request('POST', '/library/tags/bulk-assign', { body: { file_ids: fileIds, tag_ids: tagIds, action } }),
  };
}
