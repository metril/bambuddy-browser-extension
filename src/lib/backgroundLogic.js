import { HOST_PATTERNS, detectSite } from './detect.js';

export const BADGE_CLEAR_ALARM = 'badge-clear';
export const BADGE_CLEAR_MS = 3000;
const ICON = 'icons/icon128.png';

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
  if (!r?.ok) return { message: r?.error || 'Save failed', openUrl: null };
  if (r.wasExisting) return { message: 'Already in library', openUrl: null };
  const n = r.filename || (Array.isArray(r.results) ? `${r.results.length} files` : 'model');
  return { message: `Imported ${n}`, openUrl: r.openUrl || null };
}

/** Chrome-dependent wiring, injectable for tests. */
export function createBackground({ chrome, router, settings }) {
  async function flashBadge(result) {
    const { text, color } = outcomeToBadge(result);
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    await chrome.alarms.create(BADGE_CLEAR_ALARM, { when: Date.now() + BADGE_CLEAR_MS });
  }

  async function notify(result) {
    const { message, openUrl } = outcomeToNotification(result);
    const id = `bb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (openUrl) await chrome.storage.session.set({ [`notifUrl:${id}`]: openUrl });
    await chrome.notifications.create(id, { type: 'basic', iconUrl: ICON, title: 'Bambuddy', message });
  }

  async function saveUrl(url, tabId) {
    let result;
    try {
      if (!url) throw new Error('No URL to save');
      const { lastFolderId } = await settings.getSettings(['lastFolderId']);
      const msg = { type: 'save', url, folderId: lastFolderId ?? undefined };
      if (tabId != null && detectSite(url) === 'thingiverse') msg.tabId = tabId;
      result = await router.handle(msg);
    } catch (e) {
      result = { ok: false, error: e?.message || String(e), kind: 'unknown' };
    }
    await flashBadge(result);
    await notify(result);
    return result;
  }

  return {
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
