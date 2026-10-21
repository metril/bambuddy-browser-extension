// In-memory chrome.* fake for unit tests.
function area() {
  const data = {};
  const listeners = [];
  return {
    data,
    async get(keys) {
      if (keys == null) return { ...data };
      if (typeof keys === 'string') keys = [keys];
      const out = {};
      if (Array.isArray(keys)) { for (const k of keys) if (k in data) out[k] = data[k]; }
      else for (const [k, d] of Object.entries(keys)) out[k] = k in data ? data[k] : d;
      return out;
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data[k], newValue: v };
        data[k] = v;
      }
      for (const l of [...listeners]) l(changes);
    },
    async remove(keys) {
      const changes = {};
      for (const k of [].concat(keys)) {
        if (k in data) { changes[k] = { oldValue: data[k] }; delete data[k]; }
      }
      if (Object.keys(changes).length) for (const l of [...listeners]) l(changes);
    },
    onChanged: {
      addListener: (fn) => listeners.push(fn),
      removeListener: (fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    },
  };
}

export function createFakeChrome() {
  const local = area();
  const session = area();
  const calls = { alarmsCreate: [], alarmsClear: [], badgeText: [], badgeColor: [], notifications: [], messages: [] };
  return {
    calls,
    storage: { local, session },
    alarms: {
      async create(name, info) { calls.alarmsCreate.push({ name, info }); },
      async clear(name) { calls.alarmsClear.push(name); return true; },
    },
    action: {
      async setBadgeText(d) { calls.badgeText.push(d); },
      async setBadgeBackgroundColor(d) { calls.badgeColor.push(d); },
    },
    notifications: {
      async create(id, opts) { calls.notifications.push({ id, opts }); return id; },
    },
    runtime: {
      async sendMessage(msg) { calls.messages.push(msg); },
    },
  };
}
