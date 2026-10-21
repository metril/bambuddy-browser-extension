import { createClient } from './lib/api.js';
import * as settings from './lib/settings.js';
import { createRouter } from './lib/router.js';

const router = createRouter({
  settings,
  chrome,
  execInTab: (opts) => chrome.scripting.executeScript(opts),
  async getClient() {
    const s = await settings.getSettings(['baseUrl', 'apiKey']);
    return settings.isConfigured(s) ? createClient({ baseUrl: s.baseUrl, apiKey: s.apiKey }) : null;
  },
});

chrome.runtime.onInstalled.addListener(() => console.debug('Bambuddy extension installed'));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  router.handle(message, sender).then(sendResponse);
  return true;
});
