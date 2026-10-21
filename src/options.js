import { getSettings, setSettings, normalizeBaseUrl } from './lib/settings.js';
import { validateSettingsInput, describeConnection, originPattern } from './lib/optionsLogic.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

function status(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.className = isError ? 'error' : '';
}
const showError = (e) => status(e?.message || String(e), true);

function renderDiag(diagnostics) {
  const rows = Object.entries(diagnostics || {});
  const box = $('diag');
  if (!rows.length) { box.textContent = 'No diagnostics recorded.'; return; }
  const table = document.createElement('table');
  const head = table.insertRow();
  for (const h of ['Site', 'Last strategy', 'Time', 'Error']) {
    const th = document.createElement('th');
    th.textContent = h;
    head.appendChild(th);
  }
  for (const [site, d] of rows) {
    const tr = table.insertRow();
    for (const v of [site, d?.strategy || '', d?.at ? new Date(d.at).toLocaleString() : '', d?.error || '']) tr.insertCell().textContent = v;
  }
  box.replaceChildren(table);
}

async function load() {
  const s = await getSettings();
  $('baseUrl').value = s.baseUrl;
  $('apiKey').value = s.apiKey;
  $('uploadMode').value = s.uploadMode;
  $('maxFileMB').value = s.maxFileMB;
  $('bulkConcurrency').value = s.bulkConcurrency;
  $('tagUploads').checked = !!s.tagUploads;
  renderDiag(s.diagnostics);
}

function save() {
  const baseUrl = normalizeBaseUrl($('baseUrl').value);
  const apiKey = $('apiKey').value.trim();
  const v = validateSettingsInput({ baseUrl, apiKey });
  if (!v.ok) { status(v.errors.join('\n'), true); return; }
  const pattern = originPattern(baseUrl);
  // Must be called synchronously within the click gesture, before any await.
  const granted = chrome.permissions.request({ origins: [pattern] });
  const values = {
    baseUrl, apiKey,
    uploadMode: $('uploadMode').value,
    maxFileMB: Math.max(1, Number($('maxFileMB').value) || 250),
    bulkConcurrency: Math.min(3, Math.max(1, Math.round(Number($('bulkConcurrency').value) || 2))),
    tagUploads: $('tagUploads').checked,
  };
  (async () => {
    if (!(await granted)) { status(`Permission denied — the extension can't reach ${new URL(baseUrl).origin}`, true); return; }
    await setSettings(values);
    $('baseUrl').value = baseUrl;
    status(['Saved.', ...v.warnings].join('\n'));
  })().catch(showError);
}

async function test() {
  status('Testing...');
  const r = await send({ type: 'testConnection' });
  status(describeConnection(r).join('\n'), !r?.ok);
}

$('save').onclick = save;
$('test').onclick = () => test().catch(showError);
$('toggleKey').onclick = () => {
  const hidden = $('apiKey').type === 'password';
  $('apiKey').type = hidden ? 'text' : 'password';
  $('toggleKey').textContent = hidden ? 'Hide' : 'Show';
};
$('clearDiag').onclick = () => setSettings({ diagnostics: {} }).then(() => renderDiag({})).catch(showError);

load().catch(showError);
