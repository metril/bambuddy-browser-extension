// Pure popup helpers (no DOM).
import { isConfigured } from './settings.js';
import { isModelPage, isCollectionsPage, isCollectionDetailPage } from './detect.js';

export function deriveState({ settings, tabUrl }) {
  if (!isConfigured(settings)) return { state: 'setup' };
  if (isCollectionsPage(tabUrl)) return { state: 'collections' };
  if (isCollectionDetailPage(tabUrl)) return { state: 'collection' };
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

export const SUMMARY_TTL_MS = 10 * 60 * 1000;

/** Collections -> checklist rows. */
export function collectionChoices(collections, checkedIds = []) {
  const checked = new Set(checkedIds.map(String));
  return (collections || []).map((c) => ({
    value: String(c.listId),
    label: c.count != null ? `${c.title} (${c.count})` : c.title,
    checked: checked.has(String(c.listId)),
  }));
}

/** Rows ticked in the popup -> the collections payload for startBulk. */
export function selectedCollections(collections, checkedIds) {
  const want = new Set(checkedIds.map(String));
  return (collections || []).filter((c) => want.has(String(c.listId)))
    .map(({ listId, title, slug, count }) => ({ listId, title, slug, count }));
}

/** Stored job -> what the popup should show. */
export function jobView(job, now = Date.now()) {
  if (!job || !job.status) return { kind: 'none' };
  const done = job.done || 0;
  const total = job.total || 0;
  const failed = job.failed?.length || 0;
  const counts = { done, total, skipped: job.skipped || 0, imported: job.imported?.length || 0, failed };
  const percent = total ? Math.round((done / total) * 100) : 0;
  if (job.status === 'running') {
    const text = job.phase === 'preparing' && !total ? 'Reading collections...' : `${done} / ${total} done, ${counts.skipped} skipped, ${failed} failed`;
    return { kind: 'progress', percent, text, ...counts };
  }
  const text = `Imported ${counts.imported}, skipped ${counts.skipped}, failed ${failed}`;
  if (job.status === 'interrupted') return { kind: 'interrupted', percent, text: `Interrupted at ${done} / ${total}. ${text}`, ...counts, failures: job.failed || [] };
  if (job.finishedAt && now - job.finishedAt > SUMMARY_TTL_MS) return { kind: 'none' };
  return {
    kind: 'summary', percent, text: job.status === 'cancelled' ? `Cancelled. ${text}` : text, ...counts,
    failures: (job.failed || []).map((f) => ({ title: f.title || '(import)', error: f.error })), openUrl: job.openUrl || null,
  };
}
