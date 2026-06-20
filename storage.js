// Storage layer: localStorage source-of-truth + JSON export/import + optional Apps Script cloud sync.
import { todayISO } from './logic.js';

const KEY = 'cft.state.v1';

export function defaultState() {
  return {
    version: 1,
    settings: { startingBalance: 0, anchorDate: todayISO(), cushion: 300, horizonDays: 60, syncUrl: '' },
    items: [],
    occurrences: {},
    archives: [],
    meta: { updatedAt: new Date().toISOString() },
  };
}

function migrate(s) {
  if (!s || typeof s !== 'object') return defaultState();
  const d = defaultState();
  s.settings = { ...d.settings, ...(s.settings || {}) };
  s.items = Array.isArray(s.items) ? s.items : [];
  s.occurrences = s.occurrences && typeof s.occurrences === 'object' ? s.occurrences : {};
  s.archives = Array.isArray(s.archives) ? s.archives : [];
  s.meta = { ...d.meta, ...(s.meta || {}) };
  s.version = 1;
  return s;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? migrate(JSON.parse(raw)) : defaultState();
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  state.meta = { ...(state.meta || {}), updatedAt: new Date().toISOString() };
  localStorage.setItem(KEY, JSON.stringify(state));
  return state;
}

export function exportState(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cash-flow-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function importStateFromJSON(obj) {
  return migrate(obj);
}

export function importStateFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(migrate(JSON.parse(reader.result))); }
      catch (e) { reject(new Error('That file is not valid backup JSON.')); }
    };
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsText(file);
  });
}

// ---- Optional cloud sync (Apps Script web app). text/plain avoids CORS preflight. ----
export async function pullRemote(syncUrl) {
  const res = await fetch(`${syncUrl}?client=cft`, { method: 'GET' });
  if (!res.ok) throw new Error(`pull ${res.status}`);
  const data = await res.json();
  return data && data.state ? migrate(data.state) : null;
}

export async function pushRemote(syncUrl, state) {
  const res = await fetch(syncUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ client: 'cft', state }),
  });
  if (!res.ok) throw new Error(`push ${res.status}`);
  return true;
}

// Pull on load, keep whichever is newer by meta.updatedAt. Best-effort.
export async function syncOnLoad(local) {
  if (!local.settings.syncUrl) return local;
  try {
    const remote = await pullRemote(local.settings.syncUrl);
    if (remote && (remote.meta?.updatedAt || '') > (local.meta?.updatedAt || '')) {
      remote.settings.syncUrl = local.settings.syncUrl;
      saveState(remote);
      return remote;
    }
  } catch { /* offline / not set up — stay local */ }
  return local;
}
