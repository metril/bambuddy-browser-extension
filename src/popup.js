import { getSettings } from './lib/settings.js';
import { deriveState, folderOptions, profileOptions } from './lib/popupState.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['loading', 'setup', 'unsupported', 'other', 'makerworld', 'busy', 'done', 'error'];
const show = (name) => VIEWS.forEach((v) => { $(`view-${v}`).hidden = v !== name; });
const send = (msg) => chrome.runtime.sendMessage(msg);
const openOptions = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

let tabUrl = '';
let baseUrl = '';

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
