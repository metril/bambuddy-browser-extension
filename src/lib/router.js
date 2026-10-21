// Message router. Never throws out of handle().
import { isModelPage, detectSite } from './detect.js';
import { toPickerModel, buildImportBody } from './adapters/makerworld.js';
import { flattenFolders } from './folders.js';

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

  async function getPickerData({ url }) {
    const client = await withClient();
    if (!client) return { ok: false, error: 'Not configured' };
    const page = isModelPage(url);
    const site = page ? page.site : detectSite(url);
    const [fr, { lastFolderId }] = await Promise.all([client.listFolders(), settings.getSettings(['lastFolderId'])]);
    if (!fr.ok) return fail(fr);
    const folders = flattenFolders(fr.data);
    if (site !== 'makerworld' || !page) return { ok: true, site, folders, lastFolderId };
    const rr = await client.mwResolve(url);
    if (!rr.ok) return fail(rr);
    return { ok: true, site, model: toPickerModel(rr.data), folders, lastFolderId };
  }

  async function save({ url, profileId, instanceId, folderId }) {
    const client = await withClient();
    if (!client) return { ok: false, error: 'Not configured' };
    const page = isModelPage(url);
    if (!page) return { ok: false, error: 'Not a model page' };
    if (page.site !== 'makerworld') return { ok: false, error: 'Not supported yet', site: page.site };
    let pid = profileId ?? null;
    let iid = instanceId ?? null;
    let modelId = page.id;
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
