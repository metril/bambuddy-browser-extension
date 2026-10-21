// Pure filename helpers.

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function sanitizeFilename(name, { maxLength = 120 } = {}) {
  let s = String(name ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/^[. ]+|[. ]+$/g, '');
  const dot = s.lastIndexOf('.');
  let stem = dot > 0 ? s.slice(0, dot) : s;
  let ext = dot > 0 ? s.slice(dot) : '';
  if (ext.length > 16) { stem = s; ext = ''; }
  stem = stem.replace(/[. ]+$/g, '');
  if (!stem || RESERVED.test(stem)) stem = `_${stem || 'file'}`;
  const room = Math.max(1, maxLength - ext.length);
  stem = stem.slice(0, room).replace(/[. ]+$/g, '') || '_';
  return stem + ext;
}

export function classifyFile(name) {
  const n = String(name ?? '').toLowerCase();
  if (n.endsWith('.gcode.3mf')) return 'gcode3mf';
  if (n.endsWith('.3mf')) return '3mf';
  if (n.endsWith('.stl')) return 'stl';
  if (n.endsWith('.zip')) return 'zip';
  return 'unsupported';
}

export const isUploadable = (name) => classifyFile(name) !== 'unsupported';

const SITE_LABELS = { makerworld: 'MakerWorld', printables: 'Printables', thingiverse: 'Thingiverse' };

export function siteLabel(site) {
  const s = String(site ?? '').trim();
  if (!s) return '';
  return SITE_LABELS[s.toLowerCase()] || s.charAt(0).toUpperCase() + s.slice(1);
}

export function buildNotes({ title, designer, site, url, license } = {}) {
  const label = siteLabel(site);
  let head = title ? String(title).trim() : '';
  if (designer) head += `${head ? ' ' : ''}by ${String(designer).trim()}`;
  if (label) head += `${head ? ' — ' : ''}imported from ${label}`;
  const lines = [head.trim(), url ? String(url).trim() : '', license ? `License: ${String(license).trim()}` : '']
    .filter(Boolean);
  return lines.join('\n');
}

export function folderNameFromTitle(title) {
  const s = sanitizeFilename(String(title ?? '').trim(), { maxLength: 80 });
  return s === '_file' || !String(title ?? '').trim() ? 'Imported' : s;
}
