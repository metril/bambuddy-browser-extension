// Download -> upload -> metadata pipeline. No chrome.* usage; hooks and fetchImpl are injected.
import { classifyFile, isUploadable, buildNotes, siteLabel } from './filenames.js';
import { buildMultipartStream, countingTransform } from './multipartStream.js';

const MB = 1024 * 1024;

const msg = (e) => (e && e.message) || String(e);

export async function fetchSource(fetchImpl, url, credentials) {
  try {
    const res = await fetchImpl(url, { credentials });
    if (!res.ok) return { error: `Download failed (HTTP ${res.status})` };
    return { res };
  } catch (e) {
    return { error: `Download failed: ${msg(e)}` };
  }
}

export function contentLength(res, sizeHint) {
  const n = Number(res.headers && res.headers.get && res.headers.get('content-length'));
  return Number.isFinite(n) && n > 0 ? n : sizeHint || 0;
}

// Collects the body into a Blob; throws if an unknown-size body outgrows limitBytes.
export async function readToBlob(res, { limitBytes, onBytes } = {}) {
  const chunks = [];
  let total = 0;
  if (!res.body) return new Blob([await res.arrayBuffer()]);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (limitBytes && total > limitBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`File exceeds the ${Math.round(limitBytes / MB)} MB limit`);
    }
    onBytes?.(total);
  }
  return new Blob(chunks);
}

function streamParts(res, filename, onBytes) {
  const body = res.body.pipeThrough(countingTransform(onBytes));
  const { stream, boundary } = buildMultipartStream({ field: 'file', filename, body });
  return { field: 'file', filename, contentType: 'application/octet-stream', stream, boundary };
}

export async function getOrCreateTag(client, name, cache) {
  if (cache.has(name)) return cache.get(name);
  const list = await client.listTags();
  if (!list.ok) throw new Error(list.error || 'listTags failed');
  const tags = Array.isArray(list.data) ? list.data : [];
  let tag = tags.find((t) => t && String(t.name).toLowerCase() === name.toLowerCase());
  if (!tag) {
    const created = await client.createTag(name);
    if (!created.ok) throw new Error(created.error || 'createTag failed');
    tag = created.data;
  }
  cache.set(name, tag.id);
  return tag.id;
}

async function applyThumbnail(client, id, url, fetchImpl, warnings) {
  try {
    const res = await fetchImpl(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const type = (blob.type || res.headers?.get?.('content-type') || '').toLowerCase();
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    const r = await client.setThumbnail(id, blob, `thumbnail.${ext}`);
    if (!r.ok) throw new Error(r.error);
  } catch (e) {
    warnings.push(`Thumbnail failed: ${msg(e)}`);
  }
}

async function applyMeta(client, id, meta, warnings) {
  const r = await client.updateFile(id, {
    external_url: String(meta.pageUrl || '').slice(0, 500),
    notes: buildNotes({ title: meta.title, designer: meta.designer, site: meta.site, url: meta.pageUrl, license: meta.license }),
  });
  if (!r.ok) warnings.push(`Metadata update failed: ${r.error}`);
}

async function applyTag(client, id, meta, cache, warnings) {
  try {
    const tagId = await getOrCreateTag(client, siteLabel(meta.site) || 'Imported', cache);
    const r = await client.bulkAssignTags([id], [tagId]);
    if (!r.ok) throw new Error(r.error);
  } catch (e) {
    warnings.push(`Tagging failed: ${msg(e)}`);
  }
}

export async function runUploadPipeline({ client, files = [], meta = {}, folderId, options = {}, hooks = {} }) {
  const {
    uploadMode = 'auto', maxFileMB = 250, tagUploads = false,
    fetchImpl = globalThis.fetch, credentials = 'include',
  } = options;
  const out = { ok: true, fileIds: [], results: [], warnings: [], skipped: [] };
  const tagCache = new Map();
  const limitBytes = maxFileMB * MB;
  let mode = uploadMode === 'buffer' ? 'buffer' : 'stream';
  let thumbDone = false;

  const progress = (fileIndex, filename, phase) => (bytes, total) =>
    hooks.onProgress?.({ fileIndex, filename, phase, bytes, total });

  async function doUpload(kind, fileIndex, filename, res, total, opts) {
    // Returns { r, mode } where r is the api result.
    const isZip = kind === 'zip';
    const send = async (r0, useMode) => {
      if (useMode === 'stream') {
        const parts = streamParts(r0, filename, progress(fileIndex, filename, 'upload'));
        return isZip ? client.extractZipStream(parts, opts) : client.uploadFileStream(parts, opts);
      }
      const blob = await readToBlob(r0, {
        limitBytes: total ? undefined : limitBytes,
        onBytes: (b) => progress(fileIndex, filename, 'download')(b, total),
      });
      progress(fileIndex, filename, 'upload')(blob.size, blob.size);
      return isZip ? client.extractZip(blob, filename, opts) : client.uploadFile(blob, filename, opts);
    };
    let r = await send(res, mode);
    if (mode === 'stream' && r.streamUnsupported) {
      mode = 'buffer';
      hooks.setUploadMode?.('buffer');
      const again = await fetchSource(fetchImpl, files[fileIndex].url, credentials);
      if (again.error) return { r: { ok: false, error: again.error }, used: 'buffer' };
      r = await send(again.res, 'buffer');
    }
    return { r, used: mode };
  }

  async function finishFile(id, filename) {
    await applyMeta(client, id, meta, out.warnings);
    if (meta.thumbnailUrl && !thumbDone) {
      thumbDone = true;
      await applyThumbnail(client, id, meta.thumbnailUrl, fetchImpl, out.warnings);
    }
    if (tagUploads) await applyTag(client, id, meta, tagCache, out.warnings);
    out.fileIds.push(id);
  }

  for (let i = 0; i < files.length; i++) {
    const { filename, url, sizeHint } = files[i];
    const kind = classifyFile(filename);
    if (!isUploadable(filename)) {
      out.warnings.push(`Skipped ${filename}: unsupported file type`);
      out.skipped.push({ filename, reason: 'unsupported' });
      continue;
    }
    const src = await fetchSource(fetchImpl, url, credentials);
    if (src.error) {
      out.results.push({ filename, ok: false, error: src.error, mode });
      out.ok = false;
      continue;
    }
    const total = contentLength(src.res, sizeHint);
    if (total > limitBytes) {
      const go = hooks.confirmLarge ? await hooks.confirmLarge({ filename, bytes: total }) : false;
      if (!go) {
        await src.res.body?.cancel?.().catch(() => {});
        out.warnings.push(`Skipped ${filename}: larger than ${maxFileMB} MB`);
        out.skipped.push({ filename, reason: 'too-large' });
        continue;
      }
    }
    const opts = kind === 'zip' ? { folderId, createFolderFromZip: true } : { folderId };
    let up;
    try {
      up = await doUpload(kind, i, filename, src.res, total, opts);
    } catch (e) {
      up = { r: { ok: false, error: msg(e) }, used: mode };
    }
    const { r, used } = up;
    if (!r.ok) {
      out.results.push({ filename, ok: false, error: r.error || 'Upload failed', mode: used });
      out.ok = false;
      continue;
    }
    if (kind === 'zip') {
      const extracted = (r.data && r.data.files) || [];
      for (const e of (r.data && r.data.errors) || []) out.warnings.push(`${e.filename}: ${e.error}`);
      if (!extracted.length) {
        out.results.push({ filename, ok: false, error: 'No files extracted from zip', mode: used });
        out.ok = false;
        continue;
      }
      out.results.push({ filename, ok: true, mode: used, ids: extracted.map((f) => f.file_id) });
      for (const f of extracted) {
        const k = classifyFile(f.filename);
        if (k === '3mf' || k === 'stl' || k === 'gcode3mf') await finishFile(f.file_id, f.filename);
      }
      continue;
    }
    const d = r.data || {};
    const result = { filename, ok: true, id: d.id, mode: used };
    if (d.duplicate_of != null) result.duplicateOf = d.duplicate_of;
    out.results.push(result);
    progress(i, filename, 'meta')(0, 0);
    if (d.id != null) await finishFile(d.id, filename);
  }
  return out;
}
