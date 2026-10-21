// Message router. Never throws out of handle().
import { probeStreamUpload } from './streamProbe.js';
import { isModelPage, detectSite } from './detect.js';
import { toPickerModel, buildImportBody } from './adapters/makerworld.js';
import { flattenFolders, childFolders } from './folders.js';
import { folderNameFromTitle } from './filenames.js';
import { readCollections, readCollectionItems, readCollectionsPage } from './mwPageReaders.js';
import { createBulkJob } from './bulkJob.js';
import { fetchPrintablesModel, fetchPrint, selectFiles, parseModelId } from './adapters/printables.js';
import { fetchThingiverseModel, readPageInTab, parsePageMeta, CF_ERROR } from './adapters/thingiverse.js';
import { runUploadPipeline } from './uploadPipeline.js';

const fail = (r) => ({ ok: false, error: r.error, kind: r.kind });
const openUrlFor = (baseUrl, folderId) => {
  const root = String(baseUrl || '').replace(/\/+$/, '');
  return folderId != null && folderId !== '' ? `${root}/files?folder=${folderId}` : `${root}/files`;
};

export const JOB_KEY = 'job';
export const JOB_ALARM = 'job-tick';
export const SCOPE_NOTE = 'Write access (can_manage_library) is only verified on first upload.';
const ALREADY_RUNNING = 'A bulk import is already running';

export function createRouter(deps) {
  const { getClient, settings } = deps;

  async function withClient() {
    const client = await getClient();
    return client || null;
  }

  async function testConnection() {
    const client = await withClient();
    if (!client) return { ok: false, error: 'Not configured' };
    const auth = await client.authStatus();
    if (!auth.ok) return { ok: false, auth: null, mw: null, error: auth.error, kind: auth.kind };
    // /auth/status is public, so verify the key with an authenticated call.
    const fr = await client.listFolders();
    if (!fr.ok) {
      return { ok: false, auth: null, mw: null, kind: fr.kind, error: fr.kind === 'auth' ? 'API key rejected' : fr.error };
    }
    const mw = await client.mwStatus();
    const protocol = await detectProtocol();
    const streamSupport = await probeStream();
    return { ok: true, auth: auth.data, mw: mw.ok ? mw.data : null, error: mw.ok ? null : mw.error, protocol, streamSupport, scopeNote: SCOPE_NOTE };
  }

  async function probeStream() {
    try {
      const { baseUrl, apiKey } = await settings.getSettings(['baseUrl', 'apiKey']);
      const probe = deps.probeStream || probeStreamUpload;
      const got = await probe({ baseUrl, apiKey, fetchImpl: deps.fetchImpl });
      const streamSupport = got === 'unknown' ? '' : got || ''; // unknown is retried next time
      await settings.setSetting('streamSupport', streamSupport);
      return streamSupport;
    } catch { return ''; }
  }

  async function detectProtocol() {
    try {
      const { baseUrl } = await settings.getSettings(['baseUrl']);
      const prefix = `${String(baseUrl || '').replace(/\/+$/, '')}/api/v1/`;
      const get = deps.getProtocol || ((p) => globalThis.performance?.getEntriesByType?.('resource')
        .filter((e) => e.name.startsWith(p) && e.nextHopProtocol).pop()?.nextHopProtocol);
      const protocol = (await get(prefix)) || '';
      if (protocol) await settings.setSetting('detectedProtocol', protocol);
      return protocol;
    } catch { return ''; }
  }

  async function getPickerData({ url, tabId }) {
    const client = await withClient();
    if (!client) return { ok: false, error: 'Not configured' };
    const page = isModelPage(url);
    const site = page ? page.site : detectSite(url);
    const [fr, { lastFolderId }] = await Promise.all([client.listFolders(), settings.getSettings(['lastFolderId'])]);
    if (!fr.ok) return fail(fr);
    const folders = flattenFolders(fr.data);
    if (site === 'printables' && page) return printablesPicker(url, folders, lastFolderId);
    if (site === 'thingiverse' && page) return thingiversePicker(tabId, folders, lastFolderId);
    if (site !== 'makerworld' || !page) return { ok: true, site, folders, lastFolderId };
    const rr = await client.mwResolve(url);
    if (!rr.ok) return fail(rr);
    return { ok: true, site, model: toPickerModel(rr.data), folders, lastFolderId };
  }

  const fetchImpl = (...a) => (deps.fetchImpl || globalThis.fetch)(...a);

  async function recordDiag(site, entry) {
    try {
      const { diagnostics } = await settings.getSettings(['diagnostics']);
      await settings.setSetting('diagnostics', { ...(diagnostics || {}), [site]: { at: Date.now(), ...entry } });
    } catch { /* diagnostics are best-effort */ }
  }

  async function printablesPicker(url, folders, lastFolderId) {
    try {
      const print = await fetchPrint(parseModelId(url), { fetchImpl });
      const files = selectFiles(print).map((f) => f.name);
      return {
        ok: true, site: 'printables',
        model: { title: print.title, designer: print.designer, thumbnail: print.thumbnailUrl, files, premium: print.premium },
        folders, lastFolderId,
      };
    } catch (e) {
      await recordDiag('printables', { strategy: 'graphql', error: String(e?.message || e) });
      return { ok: false, error: String(e?.message || e), kind: 'client' };
    }
  }

  async function readPage(tabId) {
    if (!deps.execInTab || tabId == null) return undefined;
    return deps.execInTab(tabId, readPageInTab, []);
  }

  async function thingiversePicker(tabId, folders, lastFolderId) {
    try {
      const pd = await readPage(tabId);
      if (!pd) throw new Error('Could not read the Thingiverse page. Reload the Thing page and try again.');
      const pm = parsePageMeta(pd);
      return {
        ok: true, site: 'thingiverse',
        model: { title: pm.title, designer: pm.designer || '', thumbnail: pm.thumbnailUrl || '', files: pm.files.map((f) => f.name) },
        folders, lastFolderId,
      };
    } catch (e) {
      await recordDiag('thingiverse', { strategy: 'none', error: String(e?.message || e) });
      return { ok: false, error: String(e?.message || e), kind: 'client' };
    }
  }

  async function saveThingiverse({ url, tabId, folderId, confirmLarge }, client) {
    return saveModel('thingiverse', { folderId, confirmLarge }, client, async () => {
      let pageData;
      try { pageData = await readPage(tabId); } catch { /* zip strategy may still work */ }
      return fetchThingiverseModel(url, { fetchImpl, pageData });
    });
  }

  const savePrintables = ({ url, folderId, confirmLarge }, client) => saveModel('printables', { folderId, confirmLarge }, client, async () => {
    const m = await fetchPrintablesModel(url, { fetchImpl });
    if (!m.files.length) throw new Error('No Bambuddy-compatible files (.3mf/.stl) on this model');
    return { ...m, strategy: 'graphql' };
  });

  async function saveModel(site, { folderId, confirmLarge }, client, getModel) {
    const fid = folderId === '' ? null : folderId ?? null;
    let model;
    try {
      model = await getModel();
    } catch (e) {
      const error = String(e?.message || e);
      await recordDiag(site, { strategy: site === 'printables' ? 'graphql' : 'none', error });
      return { ok: false, site, error, kind: 'client' };
    }
    const s = await settings.getSettings(['uploadMode', 'maxFileMB', 'tagUploads', 'baseUrl', 'detectedProtocol', 'streamSupport']);
    if (s.uploadMode === 'auto' && s.streamSupport === '') s.streamSupport = await probeStream();
    const limit = s.maxFileMB * 1048576;
    const big = model.files.filter((f) => f.sizeHint > limit).map((f) => ({ filename: f.filename, bytes: f.sizeHint }));
    if (big.length && confirmLarge !== true) {
      return {
        ok: false, site, error: `Large file(s) over ${s.maxFileMB} MB need confirmation`,
        needsConfirmLarge: { files: big }, fileIds: [], results: [], warnings: [], skipped: [],
      };
    }
    const hooks = {
      onProgress: (p) => deps.onProgress?.(p),
      confirmLarge: async () => confirmLarge === true,
      setUploadMode: async (m) => {
        try {
          if (m === 'buffer') await settings.setSetting('streamSupport', 'blocked');
        } catch { /* best-effort */ }
      },
    };
    const out = await runUploadPipeline({
      client, files: model.files, meta: model.meta, folderId: fid,
      options: { uploadMode: s.uploadMode === 'auto' && (s.streamSupport !== 'ok' || s.detectedProtocol === 'http/1.1') ? 'buffer' : s.uploadMode, maxFileMB: s.maxFileMB, tagUploads: s.tagUploads, fetchImpl },
      hooks,
    });
    const failed = out.results.find((r) => !r.ok);
    if (failed && site === 'thingiverse' && /web page instead of a file/.test(failed.error || '')) failed.error = CF_ERROR;
    await recordDiag(site, { strategy: model.strategy, ...(out.ok ? {} : { error: failed?.error || 'Upload failed' }) });
    const res = {
      ok: out.ok && out.results.some((r) => r.ok),
      site, fileIds: out.fileIds, results: out.results, warnings: out.warnings, skipped: out.skipped,
      openUrl: openUrlFor(s.baseUrl, fid),
    };
    if (!res.ok) res.error = failed?.error || 'Nothing was imported';
    else await settings.setSetting('lastFolderId', fid);
    return res;
  }

  async function save(msg) {
    const { url, profileId, instanceId, folderId } = msg;
    const client = await withClient();
    if (!client) return { ok: false, error: 'Not configured' };
    const page = isModelPage(url);
    if (!page) return { ok: false, error: 'Not a model page' };
    if (page.site === 'printables') return savePrintables(msg, client);
    if (page.site === 'thingiverse') return saveThingiverse(msg, client);
    if (page.site !== 'makerworld') return { ok: false, error: 'Not supported yet', site: page.site };
    let pid = profileId ?? null;
    let iid = instanceId ?? null;
    let modelId = Number(page.id);
    if (pid == null) {
      const rr = await client.mwResolve(url);
      if (!rr.ok) return fail(rr);
      const m = toPickerModel(rr.data);
      pid = m.defaultProfileId;
      iid = m.profiles.find((p) => String(p.id) === String(pid))?.instanceId ?? null;
      modelId = m.modelId ?? modelId;
    }
    const fid = folderId === '' ? null : folderId ?? null;
    const body = buildImportBody({ modelId, profileId: pid, instanceId: iid, folderId: fid });
    const ir = await client.mwImport(body);
    if (!ir.ok) return fail(ir);
    const d = ir.data || {};
    const outFolder = d.folder_id ?? fid;
    await settings.setSetting('lastFolderId', fid);
    const { baseUrl } = await settings.getSettings(['baseUrl']);
    return {
      ok: true,
      site: 'makerworld',
      fileId: d.library_file_id,
      filename: d.filename,
      folderId: outFolder,
      wasExisting: !!d.was_existing,
      openUrl: openUrlFor(baseUrl, outFolder),
    };
  }

  // ---- bulk import of MakerWorld collections ----
  const jobArea = () => deps.chrome?.storage?.session || deps.chrome?.storage?.local;
  const nowMs = () => (deps.now || Date.now)();
  let active = null; // { promise, job, cancelled }

  async function readJob() {
    try { return (await jobArea().get([JOB_KEY]))[JOB_KEY] ?? null; } catch { return null; }
  }
  async function writeJob(job) {
    try { await jobArea().set({ [JOB_KEY]: job }); } catch { /* best-effort */ }
  }
  const clearTick = async () => { try { await deps.chrome?.alarms?.clear(JOB_ALARM); } catch { /* ignore */ } };

  async function listCollections({ tabId }) {
    if (!deps.execInTab || tabId == null) return { ok: false, error: 'No MakerWorld tab', kind: 'client' };
    const collections = await readCollections(deps.execInTab, tabId);
    const client = await withClient();
    let folders = [];
    if (client) {
      const fr = await client.listFolders();
      if (fr.ok) folders = flattenFolders(fr.data);
    }
    return { ok: true, collections, folders };
  }

  async function resolveFolder(client, tree, created, name, parentId) {
    const key = `${parentId ?? ''}/${name}`;
    if (created.has(key)) return { id: created.get(key) };
    const hit = childFolders(tree, parentId).find((f) => f.name === name);
    if (hit) { created.set(key, hit.id); return { id: hit.id }; }
    const cr = await client.createFolder(name, parentId ?? undefined);
    if (!cr.ok) return { error: cr.error || 'Could not create folder' };
    if (cr.data?.id == null) return { error: 'Bambuddy did not return a folder id' };
    created.set(key, cr.data.id);
    return { id: cr.data.id };
  }

  function makeRun(client) {
    return async (item, signal) => {
      const rr = await client.mwResolve(item.url, { signal });
      if (!rr.ok) return { outcome: 'failed', error: rr.error || 'Resolve failed' };
      if ((rr.data?.already_imported_library_ids || []).length) return { outcome: 'skipped' };
      const ir = await client.mwImport({ model_id: Number(rr.data.model_id ?? item.externalId), folder_id: item.folderId }, { signal });
      if (!ir.ok) return { outcome: 'failed', error: ir.error || 'Import failed' };
      if (ir.data?.was_existing) return { outcome: 'skipped' };
      return { outcome: 'imported', fileId: ir.data?.library_file_id ?? null };
    };
  }

  async function runBulk(client, ctl, { tabId, collections }, meta, blank, baseUrl) {
    const pre = [];
    const view = (st) => ({ ...st, failed: [...pre, ...st.failed], ...meta });
    let chain = Promise.resolve();
    const persist = (st) => { chain = chain.then(() => writeJob(view(st))).catch(() => {}); return chain; };
    const { concurrency: conc, parentFolderId: parent } = meta;
    let final = null;
    try {
      const fr = await client.listFolders();
      if (!fr.ok) throw new Error(fr.error || 'Could not list folders');
      const page = await readCollectionsPage(deps.execInTab, tabId);
      const created = new Map();
      const items = [];
      for (const c of collections) {
        if (ctl.cancelled) break;
        const name = folderNameFromTitle(c.title);
        const f = await resolveFolder(client, fr.data, created, name, parent);
        if (f.error) { pre.push({ title: c.title, url: '', error: `Folder "${name}": ${f.error}` }); continue; }
        if (meta.openUrl == null) meta.openUrl = openUrlFor(baseUrl, f.id);
        const got = page
          ? await readCollectionItems(deps.execInTab, tabId, { listId: c.listId, title: c.title, slug: c.slug, count: c.count }, page)
          : { items: [], unreadable: true };
        if (got.unreadable) { pre.push({ title: c.title, url: '', error: 'Could not read this collection from the page' }); continue; }
        for (const it of got.items) items.push({ ...it, folderId: f.id });
      }
      if (ctl.cancelled) {
        final = { ...blank, status: 'cancelled', finishedAt: nowMs() };
      } else {
        ctl.job = createBulkJob({ items, concurrency: conc, run: makeRun(client), now: nowMs, onUpdate: (st) => { final = st; persist(st); } });
        final = await ctl.job.start();
      }
    } catch (e) {
      pre.push({ title: '', url: '', error: String(e?.message || e) });
      final = { ...blank, status: 'done', finishedAt: nowMs() };
    }
    // A normal finish was already persisted by the job's final emit.
    if (!ctl.job) await persist(final);
    await chain;
    await clearTick();
    try { await deps.onJobFinished?.(view(final)); } catch { /* notification is cosmetic */ }
  }

  async function startBulk(msg) {
    if (active) return { ok: false, error: ALREADY_RUNNING };
    const ctl = { cancelled: false, job: null };
    active = ctl;
    try {
      const client = await withClient();
      if (!client) { active = null; return { ok: false, error: 'Not configured' }; }
      if (!deps.execInTab || msg.tabId == null) { active = null; return { ok: false, error: 'No MakerWorld tab', kind: 'client' }; }
      if (!Array.isArray(msg.collections) || !msg.collections.length) { active = null; return { ok: false, error: 'No collections selected' }; }
      const s = await settings.getSettings(['baseUrl', 'bulkConcurrency']);
      const parent = msg.parentFolderId === '' ? null : msg.parentFolderId ?? null;
      const conc = Math.min(3, Math.max(1, Number(msg.concurrency ?? s.bulkConcurrency) || 2));
      const t = nowMs();
      const meta = {
        jobId: `${t}-${Math.random().toString(36).slice(2, 8)}`, tabId: msg.tabId, collections: msg.collections,
        parentFolderId: parent, concurrency: conc, openUrl: null,
      };
      const blank = { status: 'running', phase: 'preparing', total: 0, done: 0, skipped: 0, failed: [], imported: [], startedAt: t, finishedAt: null };
      // Persist before replying so an immediate getJob never sees a stale/missing job.
      await writeJob({ ...blank, ...meta });
      try { await deps.chrome?.alarms?.create(JOB_ALARM, { periodInMinutes: 0.5 }); } catch { /* keep-alive is best-effort */ }
      ctl.promise = runBulk(client, ctl, msg, meta, blank, s.baseUrl).catch(() => {}).finally(() => { active = null; });
      return { ok: true };
    } catch (e) {
      active = null;
      throw e;
    }
  }

  async function cancelBulk() {
    if (!active) return { ok: true, running: false };
    active.cancelled = true;
    active.job?.cancel();
    return { ok: true, running: true };
  }

  async function getJob() {
    return { ok: true, job: await readJob(), running: !!active };
  }

  async function dismissJob() {
    if (active) return { ok: false, error: ALREADY_RUNNING };
    try { await jobArea().remove(JOB_KEY); } catch { /* ignore */ }
    return { ok: true };
  }

  /** On SW startup: a stored "running" job has no live worker, so mark it interrupted. */
  async function markInterrupted() {
    if (active) return;
    const job = await readJob();
    if (active) return; // startBulk began while we were reading; its job is live
    if (job?.status === 'running') await writeJob({ ...job, status: 'interrupted', finishedAt: nowMs() });
    if (!active) await clearTick();
  }

  const handlers = { testConnection, getPickerData, save, listCollections, startBulk, cancelBulk, getJob, dismissJob };

  return {
    markInterrupted,
    idle: async () => { await active?.promise; },
    async handle(message) {
      try {
        const h = message && Object.hasOwn(handlers, message.type) ? handlers[message.type] : null;
        if (!h) return { ok: false, error: 'Unknown message' };
        return await h(message);
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), kind: 'client' };
      }
    },
  };
}
