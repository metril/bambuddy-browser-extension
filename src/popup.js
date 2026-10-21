import { getSettings } from './lib/settings.js';
import { deriveState, folderOptions, profileOptions } from './lib/popupState.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['loading', 'setup', 'unsupported', 'other', 'makerworld', 'printables', 'busy', 'done', 'error'];
const show = (name) => VIEWS.forEach((v) => { $(`view-${v}`).hidden = v !== name; });
const send = (msg) => chrome.runtime.sendMessage(msg);
const openOptions = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

let tabUrl = '';
let baseUrl = '';
let confirmLarge = false;

function showError(r) {
  $('error-text').textContent = r?.error || 'Something went wrong';
  $('error-auth').hidden = r?.kind !== 'auth';
  show('error');
}

function fill(select, opts) {
  select.replaceChildren(...opts.map((o) => {
    const el = document.createElement('option');
    el.value = o.value;
    el.textContent = o.label;
    el.selected = !!o.selected;
    if (o.instanceId != null) el.dataset.instanceId = o.instanceId;
    return el;
  }));
}

const mb = (b) => (b / 1048576).toFixed(1);

chrome.runtime.onMessage.addListener((m) => {
  if (m?.type !== 'progress') return;
  const where = m.total ? `${mb(m.bytes || 0)} / ${mb(m.total)} MB` : `${mb(m.bytes || 0)} MB`;
  $('busy-progress').textContent = `${m.filename || ''}: ${m.phase} ${m.phase === 'meta' ? '' : where}`.trim();
});

function showDone(r) {
  $('done-name').textContent = r.filename || (r.fileIds ? `${r.fileIds.length} file(s) imported` : '');
  $('done-existing').hidden = !r.wasExisting;
  $('done-open').href = r.openUrl;
  const w = [...(r.warnings || []), ...(r.results || []).filter((x) => !x.ok).map((x) => `${x.filename}: ${x.error}`)];
  $('done-warnings').replaceChildren(...w.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
  show('done');
}

async function savePrintables() {
  show('busy');
  $('busy-progress').textContent = '';
  let r;
  try {
    r = await send({ type: 'save', url: tabUrl, folderId: $('pr-folder').value ? Number($('pr-folder').value) : null, confirmLarge });
  } catch (e) {
    return showError({ error: e?.message || 'Extension background unavailable' });
  }
  if (r?.needsConfirmLarge) {
    $('pr-confirm-text').textContent = `${r.needsConfirmLarge.files.map((f) => `${f.filename} is ${mb(f.bytes)} MB`).join(', ')}, import anyway?`;
    $('pr-confirm').hidden = false;
    $('pr-import').hidden = true;
    return show('printables');
  }
  if (!r?.ok) return showError(r);
  showDone(r);
}

async function initPrintables() {
  let r;
  try {
    r = await send({ type: 'getPickerData', url: tabUrl });
  } catch (e) {
    return showError({ error: e?.message || 'Extension background unavailable' });
  }
  if (!r?.ok) return showError(r);
  const m = r.model;
  $('pr-title').textContent = m.title || '';
  $('pr-designer').textContent = m.designer ? `by ${m.designer}` : '';
  $('pr-thumb').hidden = !m.thumbnail;
  if (m.thumbnail) $('pr-thumb').src = m.thumbnail;
  $('pr-files').replaceChildren(...m.files.map((n) => Object.assign(document.createElement('li'), { textContent: n })));
  fill($('pr-folder'), folderOptions(r.folders, r.lastFolderId, 'Default (Printables folder)'));
  $('pr-premium').hidden = !m.premium;
  $('pr-nofiles').hidden = m.premium || m.files.length > 0;
  $('pr-import').hidden = m.premium || !m.files.length;
  $('pr-import').addEventListener('click', () => { confirmLarge = false; savePrintables().catch((e) => showError({ error: e.message })); });
  $('pr-confirm-yes').addEventListener('click', () => { confirmLarge = true; savePrintables().catch((e) => showError({ error: e.message })); });
  $('pr-confirm-no').addEventListener('click', () => { $('pr-confirm').hidden = true; $('pr-import').hidden = false; });
  show('printables');
}

async function doSave() {
  const profile = $('profile');
  const msg = {
    type: 'save',
    url: tabUrl,
    profileId: profile.value ? Number(profile.value) : undefined,
    instanceId: profile.selectedOptions[0]?.dataset.instanceId ? Number(profile.selectedOptions[0].dataset.instanceId) : undefined,
    folderId: $('folder').value ? Number($('folder').value) : null,
  };
  show('busy');
  let r;
  try {
    r = await send(msg);
  } catch (e) {
    return showError({ error: e?.message || 'Extension background unavailable' });
  }
  if (!r?.ok) return showError(r);
  $('done-name').textContent = r.filename || '';
  $('done-existing').hidden = !r.wasExisting;
  $('done-open').href = r.openUrl;
  show('done');
}

async function init() {
  $('open-options').addEventListener('click', openOptions);
  $('error-options').addEventListener('click', openOptions);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabUrl = tab?.url || '';
  const settings = await getSettings(['baseUrl', 'apiKey']);
  baseUrl = settings.baseUrl;
  const st = deriveState({ settings, tabUrl });
  if (st.state === 'printables') return initPrintables();
  if (st.state !== 'makerworld') return show(st.state);
  let r;
  try {
    r = await send({ type: 'getPickerData', url: tabUrl });
  } catch (e) {
    return showError({ error: e?.message || 'Extension background unavailable' });
  }
  if (!r?.ok) return showError(r);
  const m = r.model;
  $('title').textContent = m.title || '';
  $('designer').textContent = m.designer ? `by ${m.designer}` : '';
  $('thumb').hidden = !m.thumbnail;
  if (m.thumbnail) $('thumb').src = m.thumbnail;
  $('paid').hidden = !m.paid;
  fill($('profile'), profileOptions(m));
  fill($('folder'), folderOptions(r.folders, r.lastFolderId));
  $('dup').hidden = !m.alreadyImported.length;
  $('import').hidden = m.alreadyImported.length > 0;
  $('dup-open').addEventListener('click', () => chrome.tabs.create({ url: `${baseUrl.replace(/\/+$/, '')}/files` }));
  $('dup-anyway').addEventListener('click', () => doSave().catch((e) => showError({ error: e.message })));
  $('import').addEventListener('click', () => doSave().catch((e) => showError({ error: e.message })));
  show('makerworld');
}

init().catch((e) => showError({ error: e.message }));
