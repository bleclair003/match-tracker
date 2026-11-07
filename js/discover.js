// discover.js — the Discover tab's custom lists. Pure logic: no screens, no storage.
//
// "Events" are match listings found elsewhere: the USPSA major-match list
// (uspsa.org/matches/major) and the upcoming-match lists on PractiScore club pages.
// They don't update by themselves. A refresh (done by Claude on request, reading
// those pages in your browser) adds new ones and stamps when each was first seen.
//
// A tab is a saved filter over those events. You can add, rename, reorder and
// delete tabs on the Discover tab ("Edit tabs"), and tick "Notify me" on a tab to
// have its newly posted matches collected under the New tab (with a count badge).

export const LEVELS = [1, 2, 3];
export const NEW_DAYS = 7; // "new" = first seen within this many days

const ROMAN = { 1: 'I', 2: 'II', 3: 'III' };
export const levelLabel = (n) => (ROMAN[n] ? `Level ${ROMAN[n]}` : '');

// USPSA's major-match list (source 'uspsa-major') only promises "Level II or III";
// for those without a known level, show that and count them for either level.
const majorUnknown = (ev) => ev.level == null && ev.source === 'uspsa-major';
export const eventLevelLabel = (ev) => (ev.level ? levelLabel(ev.level) : majorUnknown(ev) ? 'Level II or III' : '');

const str = (v) => (v == null ? '' : String(v).trim());
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v) => (DATE_RE.test(str(v)) ? str(v) : '');
const uniq = (a) => [...new Set(a)];

export const normName = (s) => str(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');

// practiscore.com/clubs/<key> -> <key>
export function clubKeyFromLink(url) {
  const m = /practiscore\.com\/clubs\/([^/?#\s]+)/i.exec(str(url));
  return m ? m[1].toLowerCase() : '';
}

const STATES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
  minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', newhampshire: 'NH',
  newjersey: 'NJ', newmexico: 'NM', newyork: 'NY', northcarolina: 'NC', northdakota: 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', rhodeisland: 'RI', southcarolina: 'SC', southdakota: 'SD', tennessee: 'TN',
  texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', westvirginia: 'WV', wisconsin: 'WI',
  wyoming: 'WY', districtofcolumbia: 'DC',
};
const CODES = new Set(Object.values(STATES));

// Best guess at the 2-letter state from "Town, ST 12345" or "Town, Statename". '' if unsure.
export function stateOf(location) {
  const parts = str(location).split(',').map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 1; i--) {
    const p = parts[i].replace(/\s*\d{5}(-\d{4})?$/, '').trim();
    if (/^[a-z]{2}$/i.test(p) && CODES.has(p.toUpperCase())) return p.toUpperCase();
    const full = STATES[normName(p)];
    if (full) return full;
  }
  return '';
}

export function normalizeFilter(raw = {}) {
  const levels = Array.isArray(raw.levels) ? raw.levels.map(Number).filter((n) => LEVELS.includes(n)) : [];
  const states = (Array.isArray(raw.states) ? raw.states : str(raw.states).split(/[\s,]+/))
    .map((s) => str(s).toUpperCase()).filter((s) => CODES.has(s));
  return {
    sports: Array.isArray(raw.sports) ? uniq(raw.sports.map(str).filter(Boolean)) : [],
    levels: uniq(levels).sort(),
    followedOnly: raw.followedOnly === true || raw.followedOnly === 'on' || raw.followedOnly === 'true',
    states: uniq(states),
    text: str(raw.text),
  };
}

export function normalizeTab(raw = {}) {
  return {
    id: str(raw.id), name: str(raw.name) || 'Untitled', filter: normalizeFilter(raw.filter),
    notify: raw.notify === true || raw.notify === 'on' || raw.notify === 'true',
  };
}

export const DEFAULT_TABS = [
  { id: 'uspsa-l2-l3', name: 'USPSA Level II & III', filter: { sports: ['USPSA'], levels: [2, 3] }, notify: true },
  { id: 'my-clubs', name: 'My clubs', filter: { followedOnly: true }, notify: true },
];

export function normalizeDiscover(raw) {
  const tabs = Array.isArray(raw?.tabs) ? raw.tabs.map(normalizeTab).filter((t) => t.id) : [];
  const followedClubs = Array.isArray(raw?.followedClubs)
    ? raw.followedClubs.map((c) => ({ key: str(c.key).toLowerCase(), name: str(c.name), location: str(c.location) })).filter((c) => c.key || c.name)
    : [];
  const dismissed = raw?.dismissedNew && typeof raw.dismissedNew === 'object' ? raw.dismissedNew : {};
  return {
    tabs: tabs.length || Array.isArray(raw?.tabs) ? tabs : DEFAULT_TABS.map(normalizeTab),
    followedClubs,
    dismissedNew: Object.fromEntries(Object.entries(dismissed).filter(([, v]) => v === true)),
    lastRefresh: str(raw?.lastRefresh),
    refreshNote: str(raw?.refreshNote),
  };
}

export function normalizeEvent(raw = {}) {
  const level = Number(raw.level);
  return {
    id: str(raw.id),
    name: str(raw.name),
    sport: str(raw.sport),
    level: LEVELS.includes(level) ? level : null,
    category: str(raw.category),
    club: str(raw.club),
    clubKey: str(raw.clubKey).toLowerCase(),
    location: str(raw.location),
    state: CODES.has(str(raw.state).toUpperCase()) ? str(raw.state).toUpperCase() : stateOf(raw.location),
    startDate: date(raw.startDate),
    endDate: date(raw.endDate),
    status: str(raw.status),
    link: /^https?:\/\//i.test(str(raw.link)) ? str(raw.link) : '',
    source: str(raw.source),
    firstSeen: date(raw.firstSeen),
    lastSeen: date(raw.lastSeen),
    baseline: raw.baseline === true,
  };
}

// The clubs you follow: PractiScore follows saved by a refresh, plus every club under My clubs.
export function followedSet(discover, clubs = []) {
  const keys = new Set(discover.followedClubs.map((c) => c.key).filter(Boolean));
  const names = new Set(discover.followedClubs.map((c) => normName(c.name)).filter(Boolean));
  for (const c of clubs) {
    const k = clubKeyFromLink(c.link);
    if (k) keys.add(k);
    if (c.name) names.add(normName(c.name));
  }
  return { keys, names };
}

export function isFollowed(ev, followed) {
  return Boolean((ev.clubKey && followed.keys.has(ev.clubKey)) || (ev.club && followed.names.has(normName(ev.club))));
}

const lastDay = (ev) => ev.endDate || ev.startDate;

// Does one listing fit a tab's filter? (upcoming or still running on `today`)
export function fitsFilter(ev, filter, followed, today) {
  const f = normalizeFilter(filter);
  const words = f.text.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${ev.name} ${ev.club} ${ev.location} ${ev.category}`.toLowerCase();
  return (!lastDay(ev) || lastDay(ev) >= today)
    && (!f.sports.length || f.sports.includes(ev.sport))
    && (!f.levels.length || f.levels.includes(ev.level) || (majorUnknown(ev) && f.levels.some((n) => n >= 2)))
    && (!f.followedOnly || isFollowed(ev, followed))
    && (!f.states.length || f.states.includes(ev.state))
    && words.every((w) => hay.includes(w));
}

const byDate = (a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999') || a.name.localeCompare(b.name);

// Events for one tab, earliest first.
export function filterEvents(events, filter, followed, today) {
  return events.filter((ev) => fitsFilter(ev, filter, followed, today)).sort(byDate);
}

function daysBetween(fromYmd, toYmd) {
  const [a, b] = [fromYmd, toYmd].map((s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
  return Math.round((b - a) / 86400000);
}

// Reminders: matches from clubs you follow that showed up in the last NEW_DAYS days.
// Listings found by the very first refresh are the starting point (baseline), not "new".
export function newFromClubs(events, followed, discover, today) {
  return events
    .filter((ev) => ev.firstSeen && !ev.baseline && !discover.dismissedNew[ev.id])
    .filter((ev) => isFollowed(ev, followed))
    .filter((ev) => daysBetween(ev.firstSeen, today) <= NEW_DAYS && daysBetween(ev.firstSeen, today) >= 0)
    .filter((ev) => !lastDay(ev) || lastDay(ev) >= today)
    .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen) || (a.startDate || '').localeCompare(b.startDate || ''));
}

// Notifications: newly posted listings (first seen in the last NEW_DAYS days, not
// dismissed) that fit at least one tab with "Notify me" ticked. Each comes with the
// names of the tabs it fits. Newest first.
export function notifications(events, discover, followed, today) {
  const tabs = discover.tabs.filter((t) => t.notify);
  if (!tabs.length) return [];
  return events
    .filter((ev) => isNew(ev, today) && daysBetween(ev.firstSeen, today) >= 0 && !discover.dismissedNew[ev.id])
    .map((ev) => ({ ev, tabs: tabs.filter((t) => fitsFilter(ev, t.filter, followed, today)).map((t) => t.name) }))
    .filter((n) => n.tabs.length)
    .sort((a, b) => b.ev.firstSeen.localeCompare(a.ev.firstSeen) || byDate(a.ev, b.ev));
}

export function isNew(ev, today) {
  return Boolean(ev.firstSeen && !ev.baseline && daysBetween(ev.firstSeen, today) <= NEW_DAYS);
}

// Sports to offer in the tab editor: the app's list plus any that appear in listings.
export function sportChoices(baseSports, events) {
  return uniq([...baseSports, ...events.map((e) => e.sport).filter(Boolean)]);
}

// Is this listing already one of your saved matches? (same name and date)
export function inMyMatches(ev, matches) {
  const n = normName(ev.name);
  return matches.some((m) => m.startDate === ev.startDate && normName(m.name) === n);
}
