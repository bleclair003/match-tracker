// store.js — where records are saved. `store` is what the screens use. It starts
// as `localStore` (this browser only, localStorage). When sync is set up and
// someone signs in, app.js swaps in the cloud store from cloud.js with
// useBackend(). Every method is async so the screens don't care which one it is.

import { normalizeMatch, normalizeClub, newId } from './model.js';
import { normalizeSettings } from './reminders.js';
import { normalizeDiscover, normalizeEvent } from './discover.js';

const MATCHES_KEY = 'matchTracker.matches.v1';
const CLUBS_KEY = 'matchTracker.clubs.v1';
const SETTINGS_KEY = 'matchTracker.settings.v1';
const EVENTS_KEY = 'matchTracker.discoverEvents.v1';
const DISCOVER_KEY = 'matchTracker.discover.v1';
const PRE_RESTORE_KEY = 'matchTracker.preRestore.v2';

function readList(key, normalize) {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  // If saved data is ever damaged, stop here instead of treating it as empty;
  // treating it as empty would let the next save overwrite it.
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Saved data on this device looks damaged. Nothing was changed. Restore a backup from the Settings tab.');
  }
  return Array.isArray(parsed) ? parsed.map(normalize) : [];
}

function writeList(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    throw new Error("Couldn't save on this device (storage is full or blocked). Your last change was not saved.");
  }
}

// Insert or update one record in a list, keeping createdAt and stamping updatedAt.
function upsert(key, normalize, item) {
  const all = readList(key, normalize);
  const now = new Date().toISOString();
  const rec = normalize(item);
  if (!rec.id) rec.id = newId();
  const i = all.findIndex((x) => x.id === rec.id);
  rec.createdAt = (i >= 0 ? all[i].createdAt : rec.createdAt) || now;
  rec.updatedAt = now;
  if (i >= 0) all[i] = rec;
  else all.push(rec);
  writeList(key, all);
  return rec;
}

export const localStore = {
  kind: 'local',

  isAvailable() {
    try {
      const probe = MATCHES_KEY + '.probe';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  },

  // ---- matches
  async list() { return readList(MATCHES_KEY, normalizeMatch); },
  async get(id) { return (await this.list()).find((m) => m.id === id) || null; },
  async save(match) { return upsert(MATCHES_KEY, normalizeMatch, match); },
  async remove(id) { writeList(MATCHES_KEY, (await this.list()).filter((m) => m.id !== id)); },

  // ---- clubs
  async listClubs() { return readList(CLUBS_KEY, normalizeClub); },
  async getClub(id) { return (await this.listClubs()).find((c) => c.id === id) || null; },
  async saveClub(club) { return upsert(CLUBS_KEY, normalizeClub, club); },
  async removeClub(id) { writeList(CLUBS_KEY, (await this.listClubs()).filter((c) => c.id !== id)); },

  // ---- restore: keeps one copy of what was here before, so a restore can be undone.
  // clubs === null means the backup had no clubs, so clubs are left as they are.
  async replaceAll(records, clubs = null) {
    localStorage.setItem(PRE_RESTORE_KEY, JSON.stringify({
      matches: localStorage.getItem(MATCHES_KEY),
      clubs: localStorage.getItem(CLUBS_KEY),
    }));
    writeList(MATCHES_KEY, records.map(normalizeMatch));
    if (clubs) writeList(CLUBS_KEY, clubs.map(normalizeClub));
  },

  hasUndoRestore() {
    return localStorage.getItem(PRE_RESTORE_KEY) != null;
  },

  async undoRestore() {
    const raw = localStorage.getItem(PRE_RESTORE_KEY);
    if (raw == null) return false;
    const prev = JSON.parse(raw);
    for (const [key, value] of [[MATCHES_KEY, prev.matches], [CLUBS_KEY, prev.clubs]]) {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    localStorage.removeItem(PRE_RESTORE_KEY);
    return true;
  },

  // ---- settings: small and easy to redo, so damaged settings fall back to defaults.
  async getSettings() {
    try {
      return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'));
    } catch {
      return normalizeSettings(null);
    }
  },

  async saveSettings(settings) {
    const clean = normalizeSettings(settings);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean));
    } catch {
      throw new Error("Couldn't save settings on this device (storage is full or blocked).");
    }
    return clean;
  },

  // ---- Discover: listings found by a refresh, and your custom tabs
  async listEvents() {
    try { return readList(EVENTS_KEY, normalizeEvent); } catch { return []; }
  },
  async getDiscover() {
    try {
      return normalizeDiscover(JSON.parse(localStorage.getItem(DISCOVER_KEY) || 'null'));
    } catch {
      return normalizeDiscover(null);
    }
  },
  async saveDiscover(discover) {
    const clean = normalizeDiscover(discover);
    try {
      localStorage.setItem(DISCOVER_KEY, JSON.stringify(clean));
    } catch {
      throw new Error("Couldn't save your Discover tabs on this device (storage is full or blocked).");
    }
    return clean;
  },

  // ---- moving device-only data into a synced account
  hasData() {
    const n = (key) => { try { return (JSON.parse(localStorage.getItem(key) || '[]') || []).length; } catch { return 0; } };
    return n(MATCHES_KEY) + n(CLUBS_KEY) > 0;
  },
  // After copying to the account, keep the old copy under another name (a safety net)
  // so it isn't offered again.
  archiveAfterCopy() {
    for (const key of [MATCHES_KEY, CLUBS_KEY]) {
      const v = localStorage.getItem(key);
      if (v != null) localStorage.setItem(key + '.copiedToAccount', v);
      localStorage.removeItem(key);
    }
  },
};

// The store the screens use. Starts as the local store.
export const store = { ...localStore };

export function useBackend(backend) {
  for (const k of Object.keys(store)) delete store[k];
  Object.assign(store, backend);
}
