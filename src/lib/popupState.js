// Pure popup helpers (no DOM).
import { isConfigured } from './settings.js';
import { isModelPage } from './detect.js';

export function deriveState({ settings, tabUrl }) {
  if (!isConfigured(settings)) return { state: 'setup' };
  const page = isModelPage(tabUrl);
  if (!page) return { state: 'unsupported' };
  return { state: ['makerworld', 'printables', 'thingiverse'].includes(page.site) ? page.site : 'other', site: page.site, id: page.id };
}

export function folderOptions(folders, lastFolderId, defaultLabel = 'Default (MakerWorld folder)') {
  const sel = lastFolderId == null ? '' : String(lastFolderId);
  const opts = [{ value: '', label: defaultLabel, selected: sel === '' }];
  let found = false;
  for (const f of folders || []) {
    const selected = String(f.id) === sel;
    if (selected) found = true;
    opts.push({ value: String(f.id), label: `${'  '.repeat(f.depth || 0)}${f.name}`, selected });
  }
  if (!found) opts[0].selected = true;
  return opts;
}

export function profileOptions(model) {
  const profiles = model?.profiles || [];
  return profiles.map((p) => ({
    value: String(p.id),
    label: p.title,
    instanceId: p.instanceId ?? null,
    selected: String(p.id) === String(model.defaultProfileId),
  }));
}
