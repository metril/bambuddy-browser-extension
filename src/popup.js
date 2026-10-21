import { getSettings } from './lib/settings.js';
import { deriveState, folderOptions, profileOptions, collectionChoices, selectedCollections, jobView } from './lib/popupState.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['loading', 'setup', 'unsupported', 'makerworld', 'printables', 'busy', 'done', 'error', 'collections', 'collection', 'job'];
const show = (name) => VIEWS.forEach((v) => { $(`view-${v}`).hidden = v !== name; });
const send = (msg) => chrome.runtime.sendMessage(msg);
const openOptions = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

let tabUrl = '';
let tabId;
let site = 'printables';
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
    r = await send({ type: 'save', url: tabUrl, tabId, folderId: $('pr-folder').value ? Number($('pr-folder').value) : null, confirmLarge });
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
  const tv = site === 'thingiverse';
  let r;
  try {
    r = await send({ type: 'getPickerData', url: tabUrl, tabId });
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
  fill($('pr-folder'), folderOptions(r.folders, r.lastFolderId, tv ? 'Default (Thingiverse folder)' : 'Default (Printables folder)'));
  $('pr-premium').hidden = !m.premium;
  $('pr-nofiles').hidden = tv || m.premium || m.files.length > 0;
  $('pr-import').hidden = !tv && (m.premium || !m.files.length);
  $('pr-import').onclick = () => { confirmLarge = false; savePrintables().catch((e) => showError({ error: e.message })); };
  $('pr-confirm-yes').onclick = () => { confirmLarge = true; savePrintables().catch((e) => showError({ error: e.message })); };
  $('pr-confirm-no').onclick = () => { $('pr-confirm').hidden = true; $('pr-import').hidden = false; };
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

let collections = [];
let jobWatching = false;

function renderJob(job) {
  const v = jobView(job);
  if (v.kind === 'none') return false;
  $('job-bar').value = v.kind === 'summary' ? 100 : v.percent;
  $('job-text').textContent = v.text;
  $('job-cancel').hidden = v.kind !== 'progress';
  $('job-resume').hidden = v.kind !== 'interrupted';
  $('job-dismiss').hidden = v.kind === 'progress';
  $('job-open').hidden = !(v.kind === 'summary' && v.openUrl);
  if (v.openUrl) $('job-open').href = v.openUrl;
  $('job-failures').replaceChildren(...(v.failures || []).map((f) => Object.assign(document.createElement('li'), { textContent: `${f.title}: ${f.error}` })));
  show('job');
  return true;
}

function watchJob() {
  if (jobWatching) return;
  jobWatching = true;
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.job?.newValue && (!$('view-job').hidden || !$('view-busy').hidden)) renderJob(changes.job.newValue);
  });
}

async function startBulk(chosen, parentId) {
  if (!chosen.length) return;
  let r;
  try {
    r = await send({ type: 'startBulk', tabId, collections: chosen, parentFolderId: parentId ? Number(parentId) : null });
  } catch (e) {
    return showError({ error: e?.message || 'Extension background unavailable' });
  }
  if (!r?.ok) return showError(r);
  const g = await send({ type: 'getJob' });
  watchJob();
  renderJob(g?.job) || show('busy');
}

async function initCollections(single) {
  let r;
  try {
    r = await send({ type: 'listCollections', tabId });
  } catch (e) {
    return showError({ error: e?.message || 'Extension background unavailable' });
  }
  if (!r?.ok) return showError(r);
  collections = r.collections;
  const parentOpts = folderOptions(r.folders, null, 'Top level');
  if (single) {
    $('one-title').textContent = collections[0]?.title || '';
    fill($('one-parent'), parentOpts);
    $('one-import').onclick = () => startBulk(selectedCollections(collections, collections.map((c) => c.listId)), $('one-parent').value);
    return show('collection');
  }
  $('col-list').replaceChildren(...collectionChoices(collections).map((c) => {
    const l = document.createElement('label');
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', value: c.value, checked: c.checked });
    l.append(cb, ` ${c.label}`);
    return l;
  }));
  fill($('col-parent'), parentOpts);
  $('col-import').onclick = () => {
    const ids = [...$('col-list').querySelectorAll('input:checked')].map((i) => i.value);
    startBulk(selectedCollections(collections, ids), $('col-parent').value);
  };
  show('collections');
}

async function normalInit(st) {
  if (st.state === 'collections' || st.state === 'collection') return initCollections(st.state === 'collection');
  if (st.state === 'printables' || st.state === 'thingiverse') { site = st.state; return initPrintables(); }
  if (st.state !== 'makerworld') return show(st.state);
  return initMakerworld();
}

async function init() {
  $('open-options').onclick = openOptions;
  $('error-options').onclick = openOptions;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabUrl = tab?.url || '';
  tabId = tab?.id;
  const settings = await getSettings(['baseUrl', 'apiKey']);
  baseUrl = settings.baseUrl;
  const st = deriveState({ settings, tabUrl });
  if (st.state !== 'setup') {
    $('job-cancel').onclick = () => send({ type: 'cancelBulk' });
    $('job-dismiss').onclick = () => { send({ type: 'dismissJob' }).catch(() => {}); normalInit(st).catch((e) => showError({ error: e.message })); };
    $('job-resume').onclick = async () => {
      const job = (await send({ type: 'getJob' }))?.job;
      if (!(st.state === 'collections' || st.state === 'collection')) {
        const alive = job?.tabId != null && (await chrome.tabs.get(job.tabId).then((t) => /makerworld\.com/.test(t?.url || ''), () => false));
        if (!alive) { $('job-text').textContent = 'Open your MakerWorld collections page and press Resume'; return; }
        tabId = job.tabId;
      }
      startBulk(job?.collections || [], job?.parentFolderId);
    };
    const g = await send({ type: 'getJob' }).catch(() => null);
    if (g?.job && jobView(g.job).kind !== 'none') { watchJob(); renderJob(g.job); return; }
  }
  return normalInit(st);
}

async function initMakerworld() {
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
  $('dup-open').onclick = () => chrome.tabs.create({ url: `${baseUrl.replace(/\/+$/, '')}/files` });
  $('dup-anyway').onclick = () => doSave().catch((e) => showError({ error: e.message }));
  $('import').onclick = () => doSave().catch((e) => showError({ error: e.message }));
  show('makerworld');
}

init().catch((e) => showError({ error: e.message }));
