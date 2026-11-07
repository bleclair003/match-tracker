// stats.js — filtering and summary numbers for the Progress tab. Pure logic,
// no screen code.

import { sortKey } from './model.js';

export const seasonOf = (m) => (m.startDate || '').slice(0, 4);

// Matches with a recorded result, filtered by season / sport / division ('all' = no filter).
export function filterResults(matches, { season = 'all', sport = 'all', division = 'all' } = {}) {
  return matches
    .filter((m) => m.result)
    .filter((m) => season === 'all' || seasonOf(m) === season)
    .filter((m) => sport === 'all' || m.sport === sport)
    .filter((m) => division === 'all' || m.result.division === division)
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

const uniqueSorted = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));

// Options for the filter dropdowns, taken from what's actually been recorded.
export function filterOptions(matches, { sport = 'all' } = {}) {
  const shot = matches.filter((m) => m.result);
  return {
    seasons: uniqueSorted(shot.map(seasonOf)).reverse(),
    sports: uniqueSorted(shot.map((m) => m.sport)),
    divisions: uniqueSorted(shot.filter((m) => sport === 'all' || m.sport === sport).map((m) => m.result.division)),
  };
}

const avg = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);

export function summarize(list) {
  const withPct = list.filter((m) => m.result.matchPct != null);
  const best = withPct.reduce((b, m) => (!b || m.result.matchPct > b.result.matchPct ? m : b), null);
  const pens = list.map((m) => m.result.penalties).filter((n) => n != null);
  return {
    count: list.length,
    pctCount: withPct.length,
    avgPct: avg(withPct.map((m) => m.result.matchPct)),
    best,
    penaltiesPerMatch: avg(pens),
    divisions: uniqueSorted(list.map((m) => `${m.sport}|${m.result.division}`)),
  };
}
