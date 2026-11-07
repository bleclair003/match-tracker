// reminders.js — decides which reminders are due right now. Pure logic:
// give it matches, settings, and a time; it returns a list. Nothing here
// schedules phone alerts. Reminders only appear while the app is open.

import { toDateTime, isPast } from './model.js';

const MIN = 60 * 1000;

export const REMINDER_KINDS = [
  { key: 'regOpens', label: 'Registration opens', help: "For matches you're interested in but haven't registered for." },
  { key: 'regCloses', label: 'Registration closes', help: "For matches you're interested in but haven't registered for." },
  { key: 'matchDay', label: 'Match day', help: "For every upcoming match you haven't marked Not going." },
];

// Lead times in minutes; null means off.
export const LEAD_OPTIONS = [
  [null, 'Off'],
  [60, '1 hour before'],
  [180, '3 hours before'],
  [1440, '1 day before'],
  [2880, '2 days before'],
  [4320, '3 days before'],
  [10080, '1 week before'],
];

// Travel radius (miles) for the Discover tab's club list; null = show all.
export const RADIUS_OPTIONS = [null, 25, 50, 75, 100, 150, 200, 300];

export function defaultSettings() {
  return { leads: { regOpens: 1440, regCloses: 2880, matchDay: 2880 }, dismissed: {}, travelRadius: null };
}

export function normalizeSettings(raw) {
  const d = defaultSettings();
  const allowed = LEAD_OPTIONS.map(([v]) => v);
  const leads = {};
  for (const { key } of REMINDER_KINDS) {
    const v = raw?.leads?.[key];
    leads[key] = v === undefined || !allowed.includes(v) ? d.leads[key] : v;
  }
  const dismissed = {};
  if (raw?.dismissed && typeof raw.dismissed === 'object') {
    for (const [k, v] of Object.entries(raw.dismissed)) if (typeof k === 'string') dismissed[k] = String(v);
  }
  const travelRadius = RADIUS_OPTIONS.includes(raw?.travelRadius) ? raw.travelRadius : d.travelRadius;
  return { leads, dismissed, travelRadius };
}

// Each reminder: { key, type, match, at } where `at` is the moment it's about.
// type is one of: regOpens (opening soon), regOpen (open now, not registered),
// regCloses (closing soon), matchDay (match coming up / today).
// `key` includes the date, so if a date is changed, a dismissed reminder comes back.
export function computeReminders(matches, settings, now = new Date()) {
  const { leads, dismissed } = settings;
  const out = [];
  const add = (type, m, at) => {
    const key = `${type}:${m.id}:${at.toISOString()}`;
    if (!dismissed[key]) out.push({ key, type, match: m, at });
  };

  for (const m of matches) {
    if (m.regStatus === 'not-going' || isPast(m, now)) continue;

    const opens = toDateTime(m.regOpensDate, m.regOpensTime);            // no time: start of day
    const closes = toDateTime(m.regClosesDate, m.regClosesTime, '23:59'); // no time: end of day
    const start = toDateTime(m.startDate, m.startTime);                    // no time: start of day
    const needsToRegister = m.regStatus === 'interested';

    if (needsToRegister) {
      const closingSoon = closes && leads.regCloses != null && now < closes && now >= closes - leads.regCloses * MIN;
      if (closingSoon) {
        add('regCloses', m, closes);
      } else if (opens && leads.regOpens != null) {
        const closed = (closes && now >= closes) || (start && now >= start);
        if (now < opens && now >= opens - leads.regOpens * MIN) add('regOpens', m, opens);
        else if (now >= opens && !closed) add('regOpen', m, opens);
      }
    }

    if (start && leads.matchDay != null && now >= start - leads.matchDay * MIN) add('matchDay', m, start);
  }

  return out.sort((a, b) => a.at - b.at);
}

// Drop dismissals for matches that no longer exist, so settings don't grow forever.
export function pruneDismissed(settings, matches) {
  const ids = new Set(matches.map((m) => m.id));
  const dismissed = {};
  for (const [k, v] of Object.entries(settings.dismissed)) {
    if (ids.has(k.split(':')[1])) dismissed[k] = v;
  }
  return { ...settings, dismissed };
}
