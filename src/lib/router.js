// Message router. Never throws out of handle().
import { isModelPage, detectSite } from './detect.js';
import { toPickerModel, buildImportBody } from './adapters/makerworld.js';
import { flattenFolders } from './folders.js';
import { fetchPrintablesModel, fetchPrint, selectFiles, parseModelId } from './adapters/printables.js';
import { fetchThingiverseModel, readPageInTab, parsePageMeta, CF_ERROR } from './adapters/thingiverse.js';
import { runUploadPipeline } from './uploadPipeline.js';

const fail = (r) => ({ ok: false, error: r.error, kind: r.kind });
const openUrlFor = (baseUrl, folderId) => {
  const root = String(baseUrl || '').replace(/\/+$/, '');
  return folderId != null && folderId !== '' ? `${root}/files?folder=${folderId}` : `${root}/files`;
};

export function createRouter(deps) {
  const { getClient, settings } = deps;

  async function withClient() {
    const client = await getClient();
    return client || null;
  }

  async function testConnection() {
    const client = await withClient();
    if (!client) return { ok: false, error: 'Not configured' };
    const [auth, mw] = await Promise.all([client.authStatus(), client.mwStatus()]);
    if (!auth.ok) return { ok: false, auth: null, mw: null, error: auth.error, kind: auth.kind };
    return { ok: true, auth: auth.data, mw: mw.ok ? mw.data : null, error: mw.ok ? null : mw.error };
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
    const s = await settings.getSettings(['uploadMode', 'maxFileMB', 'tagUploads', 'baseUrl']);
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
          if (m === 'buffer' && s.uploadMode === 'auto') await settings.setSetting('uploadMode', 'buffer');
        } catch { /* best-effort */ }
      },
    };
    const out = await runUploadPipeline({
      client, files: model.files, meta: model.meta, folderId: fid,
      options: { uploadMode: s.uploadMode, maxFileMB: s.maxFileMB, tagUploads: s.tagUploads, fetchImpl },
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

  const handlers = { testConnection, getPickerData, save };

  return {
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
