// chrome.storage.local wrapper: one key per field, never read-merge-write.

export const DEFAULTS = {
  baseUrl: '',
  apiKey: '',
  lastFolderId: null,
  uploadMode: 'auto', // "auto" | "stream" | "buffer"
  maxFileMB: 250,
  bulkConcurrency: 2,
  tagUploads: true,
  detectedProtocol: '', // from the last connection test, e.g. "h2" | "http/1.1"
  streamSupport: '', // from the last connection test: "ok" | "blocked" | "h1" | ""
  diagnostics: {}, // keyed by site: { at, strategy, error }
};

const local = () => globalThis.chrome.storage.local;

export async function getSettings(keys) {
  const list = keys ? [].concat(keys) : Object.keys(DEFAULTS);
  const stored = await local().get(list);
  const out = {};
  for (const k of list) out[k] = k in stored && stored[k] !== undefined ? stored[k] : structuredClone(DEFAULTS[k]);
  return out;
}

export async function getSetting(key) {
  return (await getSettings([key]))[key];
}

export async function setSettings(obj) {
  await local().set(obj);
}

export async function setSetting(key, value) {
  await setSettings({ [key]: value });
}

export function isConfigured(settings) {
  return !!(settings && settings.baseUrl && settings.apiKey);
}

export function normalizeBaseUrl(str) {
  let s = String(str ?? '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    return '';
  }
  if (!u.hostname || (u.protocol !== 'http:' && u.protocol !== 'https:')) return '';
  let path = u.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/i, '').replace(/\/+$/, '');
  return `${u.origin}${path}`;
}

export function onSettingsChanged(cb) {
  const listener = (changes, area) => {
    if (area !== undefined && area !== 'local') return;
    cb(changes);
  };
  globalThis.chrome.storage.onChanged?.addListener(listener);
  return () => globalThis.chrome.storage.onChanged?.removeListener(listener);
}
