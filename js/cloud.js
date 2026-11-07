// cloud.js — sign-in and synced storage using Firebase (free Spark plan).
//
// How sync works: every change is written to a copy of the data kept on the
// device (Firestore's offline cache) right away, so the app works with no signal.
// Firestore uploads the changes when the device is online, and other signed-in
// devices receive them within a few seconds.
//
// Data layout (one person per account):
//   users/{uid}/matches/{matchId}
//   users/{uid}/clubs/{clubId}
//   users/{uid}/meta/settings
//   users/{uid}/events/{eventId}     Discover listings (written by a refresh)
//   users/{uid}/meta/discover        Discover tabs, followed PractiScore clubs
// firestore.rules only lets a signed-in user read and write their own users/{uid}.

import { normalizeMatch, normalizeClub, newId } from './model.js';
import { normalizeSettings } from './reminders.js';
import { normalizeDiscover, normalizeEvent } from './discover.js';

export const FIREBASE_SDK_VERSION = '13.1.0';
const SDK = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

// Local testing only: http://localhost:8123/?emulator=1 uses the Firebase emulators.
export const EMULATOR_CONFIG = { apiKey: 'demo-key', authDomain: 'demo-match-tracker.firebaseapp.com', projectId: 'demo-match-tracker' };

export async function startFirebase(config, { emulator = false } = {}) {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = initializeApp(config);
  const auth = A.initializeAuth(app, { persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence] });
  const db = F.initializeFirestore(app, {
    localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
  });
  if (emulator) {
    A.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    F.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  return { auth, db, A, F };
}

// Plain-language messages for the errors people actually hit.
export function authErrorMessage(err) {
  const code = err?.code || '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found' || code === 'auth/invalid-email') {
    return "That email and password don't match an account.";
  }
  if (code === 'auth/too-many-requests') return 'Too many tries. Wait a few minutes, or reset the password.';
  if (code === 'auth/network-request-failed') return 'No internet connection. Signing in needs signal (after that, the app works offline).';
  if (code === 'auth/user-disabled') return 'This account has been turned off in the Firebase console.';
  return err?.message || 'Sign-in failed.';
}

const PRE_RESTORE_PREFIX = 'matchTracker.cloudPreRestore.';

// Returns a store with the same methods as the local one (see store.js), plus
// attach()/detach(). onRemoteChange fires when another device changed something;
// onStatus reports { pending } (true while changes are waiting to upload);
// onError reports write or listen failures.
export function createCloudStore({ db, F }, uid, { onRemoteChange, onStatus, onError } = {}) {
  const userDoc = (...path) => F.doc(db, 'users', uid, ...path);
  const userCol = (name) => F.collection(db, 'users', uid, name);

  const state = { matches: new Map(), clubs: new Map(), events: new Map(), settings: normalizeSettings(null), discover: normalizeDiscover(null) };
  const pending = { matches: false, clubs: false, events: false, settings: false, discover: false };
  let unsubs = [];
  let attached = false;

  const reportStatus = () => onStatus?.({ pending: Object.values(pending).some(Boolean) });
  const fail = (err) => { console.error(err); onError?.(err); };
  // Writes go to the device copy immediately. The promise only finishes once the
  // server has the change, which can be much later when offline, so it isn't awaited.
  const write = (promise) => { promise.catch(fail); };

  function listenCollection(name, normalize) {
    return new Promise((resolve) => {
      unsubs.push(F.onSnapshot(userCol(name), { includeMetadataChanges: true }, (snap) => {
        pending[name] = snap.metadata.hasPendingWrites;
        reportStatus();
        const changes = snap.docChanges();
        if (changes.length || !attached) {
          const map = new Map();
          snap.forEach((d) => map.set(d.id, normalize({ ...d.data(), id: d.id })));
          state[name] = map;
          if (attached && changes.length && !snap.metadata.hasPendingWrites) onRemoteChange?.();
        }
        resolve();
      }, (err) => { fail(err); resolve(); }));
    });
  }

  function listenSettings() {
    return new Promise((resolve) => {
      unsubs.push(F.onSnapshot(userDoc('meta', 'settings'), { includeMetadataChanges: true }, (snap) => {
        pending.settings = snap.metadata.hasPendingWrites;
        reportStatus();
        const next = normalizeSettings(snap.exists() ? snap.data() : null);
        const changed = JSON.stringify(next) !== JSON.stringify(state.settings);
        state.settings = next;
        if (attached && changed && !snap.metadata.hasPendingWrites) onRemoteChange?.();
        resolve();
      }, (err) => { fail(err); resolve(); }));
    });
  }

  function listenDiscover() {
    return new Promise((resolve) => {
      unsubs.push(F.onSnapshot(userDoc('meta', 'discover'), { includeMetadataChanges: true }, (snap) => {
        pending.discover = snap.metadata.hasPendingWrites;
        reportStatus();
        const next = normalizeDiscover(snap.exists() ? snap.data() : null);
        const changed = JSON.stringify(next) !== JSON.stringify(state.discover);
        state.discover = next;
        if (attached && changed && !snap.metadata.hasPendingWrites) onRemoteChange?.();
        resolve();
      }, (err) => { fail(err); resolve(); }));
    });
  }

  function upsert(name, normalize, item) {
    const now = new Date().toISOString();
    const rec = normalize(item);
    if (!rec.id) rec.id = newId();
    const prev = state[name].get(rec.id);
    rec.createdAt = (prev ? prev.createdAt : rec.createdAt) || now;
    rec.updatedAt = now;
    state[name].set(rec.id, rec);
    write(F.setDoc(F.doc(userCol(name), rec.id), rec));
    return rec;
  }

  function remove(name, id) {
    state[name].delete(id);
    write(F.deleteDoc(F.doc(userCol(name), id)));
  }

  // Replace a whole collection in batches (Firestore allows 500 writes per batch).
  async function replaceCollection(name, normalize, items) {
    const next = new Map(items.map((x) => { const r = normalize(x); if (!r.id) r.id = newId(); return [r.id, r]; }));
    const ops = [];
    for (const id of state[name].keys()) if (!next.has(id)) ops.push((b) => b.delete(F.doc(userCol(name), id)));
    for (const [id, rec] of next) ops.push((b) => b.set(F.doc(userCol(name), id), rec));
    for (let i = 0; i < ops.length; i += 400) {
      const batch = F.writeBatch(db);
      ops.slice(i, i + 400).forEach((op) => op(batch));
      write(batch.commit());
    }
    state[name] = next;
  }

  const sorted = (map) => [...map.values()];

  return {
    kind: 'cloud',
    uid,

    async attach() {
      await Promise.all([
        listenCollection('matches', normalizeMatch), listenCollection('clubs', normalizeClub),
        listenCollection('events', normalizeEvent), listenSettings(), listenDiscover(),
      ]);
      attached = true;
    },
    detach() {
      unsubs.forEach((u) => u());
      unsubs = [];
      attached = false;
    },

    isAvailable() { return true; },

    async list() { return sorted(state.matches); },
    async get(id) { return state.matches.get(id) || null; },
    async save(match) { return upsert('matches', normalizeMatch, match); },
    async remove(id) { remove('matches', id); },

    async listClubs() { return sorted(state.clubs); },
    async getClub(id) { return state.clubs.get(id) || null; },
    async saveClub(club) { return upsert('clubs', normalizeClub, club); },
    async removeClub(id) { remove('clubs', id); },

    async getSettings() { return structuredClone(state.settings); },
    async saveSettings(settings) {
      const clean = normalizeSettings(settings);
      state.settings = clean;
      write(F.setDoc(userDoc('meta', 'settings'), clean));
      return clean;
    },

    async listEvents() { return sorted(state.events); },
    async getDiscover() { return structuredClone(state.discover); },
    async saveDiscover(discover) {
      const clean = normalizeDiscover(discover);
      state.discover = clean;
      write(F.setDoc(userDoc('meta', 'discover'), clean));
      return clean;
    },

    // Restore: a copy of the current data is kept on this device so it can be undone.
    async replaceAll(records, clubs = null) {
      try {
        localStorage.setItem(PRE_RESTORE_PREFIX + uid, JSON.stringify({ matches: sorted(state.matches), clubs: sorted(state.clubs) }));
      } catch { /* undo just won't be offered */ }
      await replaceCollection('matches', normalizeMatch, records);
      if (clubs) await replaceCollection('clubs', normalizeClub, clubs);
    },
    hasUndoRestore() {
      try { return localStorage.getItem(PRE_RESTORE_PREFIX + uid) != null; } catch { return false; }
    },
    async undoRestore() {
      const raw = localStorage.getItem(PRE_RESTORE_PREFIX + uid);
      if (raw == null) return false;
      const prev = JSON.parse(raw);
      await replaceCollection('matches', normalizeMatch, prev.matches || []);
      await replaceCollection('clubs', normalizeClub, prev.clubs || []);
      localStorage.removeItem(PRE_RESTORE_PREFIX + uid);
      return true;
    },
  };
}
