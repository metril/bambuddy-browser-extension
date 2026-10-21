import { createClient } from './lib/api.js';
import * as settings from './lib/settings.js';
import { createRouter } from './lib/router.js';
import { createBackground } from './lib/backgroundLogic.js';
import { execInTab } from './execInTab.js';

const router = createRouter({
  settings,
  chrome,
  onProgress: (p) => { chrome.runtime.sendMessage({ type: 'progress', ...p }).catch(() => {}); },
  execInTab,
  onJobFinished: (job) => bg.onJobFinished(job),
  async getClient() {
    const s = await settings.getSettings(['baseUrl', 'apiKey']);
    return settings.isConfigured(s) ? createClient({ baseUrl: s.baseUrl, apiKey: s.apiKey }) : null;
  },
});

const bg = createBackground({ chrome, router, settings });

// A stored running job has no live worker after any SW (re)start.
router.markInterrupted();
chrome.runtime.onStartup.addListener(() => { router.markInterrupted(); });
chrome.runtime.onInstalled.addListener(() => { bg.install(); });
chrome.contextMenus.onClicked.addListener((info, tab) => { bg.onMenuClick(info, tab); });
chrome.commands.onCommand.addListener((command) => { bg.onCommand(command); });
chrome.alarms.onAlarm.addListener((alarm) => { bg.onAlarm(alarm); });
chrome.notifications.onClicked.addListener((id) => { bg.onNotificationClicked(id); });
chrome.notifications.onClosed.addListener((id) => { bg.onNotificationClosed(id); });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  router.handle(message, sender).then(sendResponse);
  return true;
});
