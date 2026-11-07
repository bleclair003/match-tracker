// model.js — what a match record looks like, how it's validated, and the
// backup file format. No screen code and no storage code lives here, so this
// file stays the same when sync is added later.

export const SPORTS = ['USPSA', 'IDPA', 'Steel Challenge', 'PCSL', '3-Gun', 'Other'];

export const REG_STATUSES = [
  { value: 'interested', label: 'Interested' },
  { value: 'registered', label: 'Registered' },
  { value: 'waitlisted', label: 'Waitlisted' },
  { value: 'not-going', label: 'Not going' },
];

// Typing suggestions only. The inputs accept any text, so a sport or division
// that isn't listed here still works.
export const DIVISION_SUGGESTIONS = {
  USPSA: ['Open', 'Limited', 'Limited Optics', 'Carry Optics', 'Production', 'Single Stack', 'Revolver', 'PCC'],
  IDPA: ['SSP', 'ESP', 'CDP', 'CCP', 'CO', 'REV', 'BUG', 'PCC'],
};
export const CLASS_SUGGESTIONS = {
  USPSA: ['GM', 'M', 'A', 'B', 'C', 'D', 'U'],
  IDPA: ['Distinguished Master', 'Master', 'Expert', 'Sharpshooter', 'Marksman', 'Novice', 'Unclassified'],
};

// ---- small cleaners -------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const str = (v) => (v == null ? '' : String(v).trim());
const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const date = (v) => (DATE_RE.test(str(v)) ? str(v) : '');
const time = (v) => (TIME_RE.test(str(v)) ? str(v) : '');

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

// ---- dates (all local time, stored as "YYYY-MM-DD" and "HH:MM") -----------

export function parseYMD(s) {
  if (!DATE_RE.test(s || '')) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toDateTime(dateStr, timeStr, fallbackTime = '00:00') {
  const d = parseYMD(dateStr);
  if (!d) return null;
  const [hh, mm] = (TIME_RE.test(timeStr || '') ? timeStr : fallbackTime).split(':').map(Number);
  d.setHours(hh, mm, 0, 0);
  return d;
}

// A match counts as "upcoming" until the end of its last day.
export function isPast(m, now = new Date()) {
  const last = parseYMD(m.endDate || m.startDate);
  if (!last) return false;
  last.setDate(last.getDate() + 1);
  return now >= last;
}

export function hasStarted(m, now = new Date()) {
  const start = parseYMD(m.startDate);
  return !!start && start <= now;
}

export const sortKey = (m) => `${m.startDate || '9999-99-99'}T${m.startTime || '00:00'}`;

// ---- records ---------------------------------------------------------------

export function normalizeResult(raw = {}) {
  return {
    division: str(raw.division),
    classification: str(raw.classification),
    placeDivision: num(raw.placeDivision),
    totalDivision: num(raw.totalDivision),
    placeOverall: num(raw.placeOverall),
    totalOverall: num(raw.totalOverall),
    matchPct: num(raw.matchPct),
    points: num(raw.points),
    penalties: num(raw.penalties),
    resultsLink: str(raw.resultsLink),
    notes: str(raw.notes),
  };
}

export function normalizeMatch(raw = {}) {
  return {
    id: str(raw.id),
    name: str(raw.name),
    sport: str(raw.sport) || 'USPSA',
    club: str(raw.club),
    location: str(raw.location),
    startDate: date(raw.startDate),
    startTime: time(raw.startTime),
    endDate: date(raw.endDate),
    regOpensDate: date(raw.regOpensDate),
    regOpensTime: time(raw.regOpensTime),
    regClosesDate: date(raw.regClosesDate),
    regClosesTime: time(raw.regClosesTime),
    regLink: str(raw.regLink),
    fee: num(raw.fee),
    regStatus: REG_STATUSES.some((s) => s.value === raw.regStatus) ? raw.regStatus : 'interested',
    notes: str(raw.notes),
    result: raw.result ? normalizeResult(raw.result) : null,
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

// Each validator returns { fieldName: 'message' }; an empty object means OK.
export function validateMatch(m) {
  const e = {};
  if (!m.name) e.name = 'Give the match a name.';
  if (!m.startDate) e.startDate = 'Pick the match date.';
  if (m.endDate && m.startDate && m.endDate < m.startDate) e.endDate = 'Last day is before the first day.';
  if (m.regLink && !isHttpUrl(m.regLink)) e.regLink = 'Use a full web address starting with https://';
  if (m.fee != null && m.fee < 0) e.fee = "Fee can't be negative.";
  const opens = toDateTime(m.regOpensDate, m.regOpensTime);
  const closes = toDateTime(m.regClosesDate, m.regClosesTime, '23:59');
  if (opens && closes && closes < opens) e.regClosesDate = 'Registration closes before it opens.';
  if (!m.regOpensDate && m.regOpensTime) e.regOpensDate = 'Add a date for this time.';
  if (!m.regClosesDate && m.regClosesTime) e.regClosesDate = 'Add a date for this time.';
  return e;
}

const isPosInt = (n) => Number.isInteger(n) && n > 0;

export function validateResult(r) {
  const e = {};
  if (r.matchPct != null && (r.matchPct < 0 || r.matchPct > 100)) e.matchPct = 'Match % must be between 0 and 100.';
  for (const [place, total] of [['placeDivision', 'totalDivision'], ['placeOverall', 'totalOverall']]) {
    if (r[place] != null && !isPosInt(r[place])) e[place] = 'Use a whole number, 1 or more.';
    if (r[total] != null && !isPosInt(r[total])) e[total] = 'Use a whole number, 1 or more.';
    if (isPosInt(r[place]) && isPosInt(r[total]) && r[place] > r[total]) e[place] = 'Place is higher than the number of shooters.';
  }
  if (r.penalties != null && !(Number.isInteger(r.penalties) && r.penalties >= 0)) e.penalties = 'Use a whole number, 0 or more.';
  if (r.resultsLink && !isHttpUrl(r.resultsLink)) e.resultsLink = 'Use a full web address starting with https://';
  return e;
}

// ---- clubs -----------------------------------------------------------------

export function normalizeClub(raw = {}) {
  const sports = Array.isArray(raw.sports) ? raw.sports.map(str).filter(Boolean) : [];
  return {
    id: str(raw.id),
    name: str(raw.name),
    sports: [...new Set(sports)],
    location: str(raw.location),
    miles: num(raw.miles),
    link: str(raw.link),
    notes: str(raw.notes),
    favorite: raw.favorite === true || raw.favorite === 'on' || raw.favorite === 'true',
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

export function validateClub(c) {
  const e = {};
  if (!c.name) e.name = 'Give the club a name.';
  if (c.miles != null && c.miles < 0) e.miles = "Miles can't be negative.";
  if (c.link && !isHttpUrl(c.link)) e.link = 'Use a full web address starting with https://';
  return e;
}

// ---- backup file ----------------------------------------------------------

export const BACKUP_APP = 'match-tracker';
export const BACKUP_VERSION = 1;

export function buildBackup(records, clubs = []) {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), records, clubs };
}

// Returns { records, clubs, skipped } or throws an Error with a plain-language message.
// `clubs` is null for backups made before clubs existed (restore then leaves clubs alone).
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file couldn't be read. Pick a .json backup made by this app.");
  }
  if (!data || data.app !== BACKUP_APP || !Array.isArray(data.records)) {
    throw new Error("That file isn't a Match Tracker backup.");
  }
  if (Number(data.version) > BACKUP_VERSION) {
    throw new Error('That backup came from a newer version of this app. Update the app first.');
  }
  const records = [];
  const skipped = [];
  const seen = new Set();
  data.records.forEach((raw, i) => {
    const m = normalizeMatch(raw);
    if (!m.id || seen.has(m.id)) m.id = newId();
    const errors = { ...validateMatch(m), ...(m.result ? validateResult(m.result) : {}) };
    if (Object.keys(errors).length) {
      skipped.push({ index: i, name: m.name || '(no name)', reason: Object.values(errors)[0] });
      return;
    }
    seen.add(m.id);
    records.push(m);
  });

  let clubs = null;
  if (Array.isArray(data.clubs)) {
    clubs = [];
    const seenClubs = new Set();
    data.clubs.forEach((raw, i) => {
      const c = normalizeClub(raw);
      if (!c.id || seenClubs.has(c.id)) c.id = newId();
      const errors = validateClub(c);
      if (Object.keys(errors).length) {
        skipped.push({ index: i, name: `Club: ${c.name || '(no name)'}`, reason: Object.values(errors)[0] });
        return;
      }
      seenClubs.add(c.id);
      clubs.push(c);
    });
  }
  return { records, clubs, skipped };
}
