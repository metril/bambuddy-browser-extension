// Pure helpers for the options page.
import { normalizeBaseUrl } from './settings.js';

export function isInsecureRemote(url) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (u.protocol !== 'http:') return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return false;
  if (!h.includes('.') && !h.includes(':')) return false; // single-label host (e.g. http://bambuddy:8000)
  if (/\.(local|lan|internal)$/.test(h) || h.endsWith('.home.arpa')) return false;
  const m = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return false;
  }
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return false;
  return true;
}

export function validateSettingsInput({ baseUrl, apiKey }) {
  const errors = [];
  const warnings = [];
  const url = normalizeBaseUrl(baseUrl);
  if (!url) errors.push('Enter a valid Bambuddy URL (http or https).');
  if (!String(apiKey ?? '').trim()) errors.push('Enter your API key.');
  else if (!String(apiKey).trim().startsWith('bb_')) warnings.push('API keys normally start with "bb_" - double-check yours.');
  if (url && isInsecureRemote(url)) warnings.push('Your API key will be sent unencrypted over the network.');
  return { ok: errors.length === 0, errors, warnings };
}

export function originPattern(baseUrl) {
  const url = normalizeBaseUrl(baseUrl);
  return url ? `${new URL(url).origin}/*` : '';
}

export function describeConnection(r) {
  if (r && !r.ok && r.kind === 'auth' && r.error === 'API key rejected') return ['API key rejected'];
  if (!r || !r.ok) return [`Connection failed: ${r?.error || 'unknown error'}`];
  const lines = [`Auth: ${r.auth?.auth_enabled ? 'enabled' : 'disabled'}`, 'API key accepted'];
  if (r.mw?.sign_in_expired) lines.push('MakerWorld cloud: sign-in expired');
  else if (r.mw?.has_cloud_token) lines.push('MakerWorld cloud: signed in');
  else if (r.mw) lines.push('MakerWorld cloud: no cloud token');
  else lines.push(/expired|401|403|sign/i.test(r.error || '') ? 'MakerWorld cloud: sign-in expired' : 'MakerWorld cloud: unavailable');
  if (r.protocol) lines.push(`HTTP protocol: ${r.protocol}`);
  const stream = {
    ok: 'supported',
    blocked: 'blocked by your proxy (buffer mode will be used)',
    h1: 'not available over HTTP/1.1 (buffer mode will be used)',
  }[r.streamSupport] || 'unknown (run Test connection)';
  lines.push(`Streaming uploads: ${stream}`);
  if (r.scopeNote) lines.push(r.scopeNote);
  return lines;
}
