import { HOST_PATTERNS, detectSite } from './detect.js';

export const BADGE_CLEAR_ALARM = 'badge-clear';
export const BADGE_CLEAR_MS = 3000;
export const KEEPALIVE_MS = 20000;

export function menuDefinitions() {
  return [
    { id: 'bb-save-page', title: 'Save model to Bambuddy', contexts: ['page'], documentUrlPatterns: HOST_PATTERNS },
    { id: 'bb-save-link', title: 'Save linked model to Bambuddy', contexts: ['link'], targetUrlPatterns: HOST_PATTERNS },
  ];
}

export function outcomeToBadge(r) {
  if (r?.ok) return r.wasExisting ? { text: '=', color: '#808080' } : { text: '✓', color: '#2e9e4f' };
  return { text: '!', color: '#d33a3a' };
}

export function outcomeToNotification(r) {
  if (r?.bulkMessage) return { message: r.bulkMessage, openUrl: r.openUrl || null };
  if (r?.needsConfirmLarge) return { message: 'File too large for one-click import — open the popup to confirm', openUrl: null };
  if (!r?.ok) return { message: r?.error || 'Save failed', openUrl: null };
  if (r.wasExisting) return { message: 'Already in library', openUrl: null };
  const n = r.filename || (Array.isArray(r.results) ? `${r.results.filter((x) => x.ok).length} files` : 'model');
  return { message: `Imported ${n}`, openUrl: r.openUrl || null };
}

/** Chrome-dependent wiring, injectable for tests. */
export function createBackground({ chrome, router, settings }) {
  async function flashBadge(result) {
    const { text, color } = outcomeToBadge(result);
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    // Fast clear while the SW is alive; the alarm is the restart-safe fallback.
    setTimeout(() => { Promise.resolve(chrome.action.setBadgeText({ text: '' })).catch(() => {}); }, BADGE_CLEAR_MS).unref?.();
    await chrome.alarms.create(BADGE_CLEAR_ALARM, { when: Date.now() + BADGE_CLEAR_MS });
  }

  async function notify(result) {
    const { message, openUrl } = outcomeToNotification(result);
    const id = `bb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (openUrl) await chrome.storage.session.set({ [`notifUrl:${id}`]: openUrl });
    await chrome.notifications.create(id, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: 'Bambuddy', message });
  }

  async function saveUrl(url, tabId) {
    let result;
    // Pings a trivial extension API so the service worker is not stopped mid-save.
    const keepAlive = setInterval(() => { Promise.resolve(chrome.runtime.getPlatformInfo()).catch(() => {}); }, KEEPALIVE_MS);
    try {
      if (!url) throw new Error('No URL to save');
      const { lastFolderId } = await settings.getSettings(['lastFolderId']);
      const msg = { type: 'save', url, folderId: lastFolderId ?? undefined };
      if (tabId != null && detectSite(url) === 'thingiverse') msg.tabId = tabId;
      result = await router.handle(msg);
    } catch (e) {
      result = { ok: false, error: e?.message || String(e), kind: 'unknown' };
    } finally {
      clearInterval(keepAlive);
    }
    try { await flashBadge(result); } catch { /* cosmetic */ }
    try { await notify(result); } catch { /* cosmetic */ }
    return result;
  }

  async function onJobFinished(job) {
    const failed = job?.failed?.length ?? 0;
    const label = job?.status === 'cancelled' ? 'Cancelled. ' : '';
    const result = {
      ok: failed === 0,
      bulkMessage: `${label}Imported ${job?.imported?.length ?? 0}, skipped ${job?.skipped ?? 0}, failed ${failed}`,
      openUrl: job?.openUrl || null,
    };
    try { await flashBadge(result); } catch { /* cosmetic */ }
    try { await notify(result); } catch { /* cosmetic */ }
    return result;
  }

  return {
    onJobFinished,
    flashBadge,
    notify,
    saveUrl,
    async install() {
      await chrome.contextMenus.removeAll();
      for (const d of menuDefinitions()) chrome.contextMenus.create(d);
    },
    onMenuClick(info, tab) {
      if (info.menuItemId === 'bb-save-link') return saveUrl(info.linkUrl);
      if (info.menuItemId === 'bb-save-page') return saveUrl(info.pageUrl || tab?.url, tab?.id);
    },
    async onCommand(command) {
      if (command !== 'save-current-page') return;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return saveUrl(tab?.url, tab?.id);
    },
    async onAlarm(alarm) {
      if (alarm.name === BADGE_CLEAR_ALARM) await chrome.action.setBadgeText({ text: '' });
    },
    async onNotificationClosed(id) {
      try { await chrome.storage.session.remove(`notifUrl:${id}`); } catch { /* best-effort */ }
    },
    async onNotificationClicked(id) {
      const key = `notifUrl:${id}`;
      const got = await chrome.storage.session.get([key]);
      await chrome.notifications.clear?.(id);
      if (got[key]) {
        await chrome.storage.session.remove(key);
        await chrome.tabs.create({ url: got[key] });
      }
    },
  };
}
