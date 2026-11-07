// app.js — the screens. Each screen is a render function picked by the
// address-bar hash (#upcoming, #match/<id>, ...). Data access goes through
// `store`, data rules through model.js.

import {
  SPORTS, REG_STATUSES, DIVISION_SUGGESTIONS, CLASS_SUGGESTIONS,
  normalizeMatch, normalizeResult, validateMatch, validateResult,
  buildBackup, parseBackup, parseYMD, isPast, hasStarted, sortKey,
  normalizeClub, validateClub,
} from './model.js';
import { store } from './store.js';
import { REMINDER_KINDS, LEAD_OPTIONS, RADIUS_OPTIONS, computeReminders, pruneDismissed } from './reminders.js';
import { MATCH_SOURCES, LINKS_CHECKED } from './sources.js';
import { seasonOf, filterResults, filterOptions, summarize } from './stats.js';

const view = document.getElementById('view');

// Test clock: add ?now=2026-11-10T19:30 to the address to see what the app
// shows at that moment. Without it, the real time is used.
const TEST_NOW = (() => {
  const v = new URLSearchParams(location.search).get('now');
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
})();
const clock = () => (TEST_NOW ? new Date(TEST_NOW) : new Date());

// ---- helpers ---------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const href = (...parts) => '#' + parts.map(encodeURIComponent).join('/');

function fmtDate(ymd, withYear = true) {
  const d = parseYMD(ymd);
  if (!d) return '';
  return d.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}),
  });
}

function fmtTime(hm) {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const fmtDateTime = (d, t) => [fmtDate(d), fmtTime(t)].filter(Boolean).join(' · ');

function fmtWhen(m) {
  if (m.endDate && m.endDate !== m.startDate) {
    return `${fmtDate(m.startDate, false)} – ${fmtDate(m.endDate)}${m.startTime ? ' · starts ' + fmtTime(m.startTime) : ''}`;
  }
  return fmtDateTime(m.startDate, m.startTime);
}

const fmtMoney = (n) => (n == null ? '' : n.toLocaleString(undefined, { style: 'currency', currency: 'USD' }));

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function daysUntil(ymd, now = new Date()) {
  const d = parseYMD(ymd);
  if (!d) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d - today) / 86400000);
}

function relativeDay(m, now = new Date()) {
  const n = daysUntil(m.startDate, now);
  if (n == null) return '';
  if (n <= 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return `In ${n} days`;
}

const statusLabel = (v) => REG_STATUSES.find((s) => s.value === v)?.label || v;
const statusPill = (m) => `<span class="pill pill-${esc(m.regStatus)}">${esc(statusLabel(m.regStatus))}</span>`;

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 2500);
}

function showBanner(msg) {
  const el = document.getElementById('banner');
  el.textContent = msg;
  el.hidden = false;
}

function showError(err) {
  console.error(err);
  view.innerHTML = `<div class="panel error-panel"><h2>Something went wrong</h2><p>${esc(err.message || err)}</p>
    <a class="btn" href="#settings">Go to Settings</a></div>`;
}

let navCount = 0;
function goBack(fallback) {
  if (navCount > 1) history.back();
  else location.hash = fallback;
}

// ---- match card (used by lists) -------------------------------------------

function dateBox(m, { showYear = false } = {}) {
  const d = parseYMD(m.startDate);
  if (!d) return '<div class="datebox"></div>';
  return `<div class="datebox" aria-hidden="true">
    <span class="mon">${d.toLocaleDateString(undefined, { month: 'short' })}</span>
    <span class="day">${d.getDate()}</span>
    <span class="dow">${showYear ? d.getFullYear() : d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
  </div>`;
}

function regLine(m, now) {
  if (m.regStatus === 'registered' || m.regStatus === 'not-going') return '';
  const opens = m.regOpensDate && daysUntil(m.regOpensDate, now);
  if (m.regOpensDate && (opens > 0 || (opens === 0 && m.regOpensTime && fmtNowHM(now) < m.regOpensTime))) {
    return `<span class="reg-line">Reg opens ${esc(fmtDateTime(m.regOpensDate, m.regOpensTime).replace(/, \d{4}/, ''))}</span>`;
  }
  if (m.regClosesDate && daysUntil(m.regClosesDate, now) >= 0) {
    return `<span class="reg-line">Reg closes ${esc(fmtDateTime(m.regClosesDate, m.regClosesTime).replace(/, \d{4}/, ''))}</span>`;
  }
  return '';
}
const fmtNowHM = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function matchCard(m, now, { link = href('match', m.id), meta = '' } = {}) {
  const sub = [m.sport, m.club].filter(Boolean).join(' · ');
  return `<a class="card match-card${m.regStatus === 'not-going' ? ' dim' : ''}" href="${link}">
    ${dateBox(m)}
    <div class="card-body">
      <div class="card-title">${esc(m.name)}</div>
      ${sub ? `<div class="card-sub">${esc(sub)}</div>` : ''}
      ${m.location ? `<div class="card-sub">${esc(m.location)}</div>` : ''}
      <div class="card-meta">${meta || `${statusPill(m)}<span class="when">${esc(relativeDay(m, now))}</span>${regLine(m, now)}`}</div>
    </div>
  </a>`;
}

// ---- screens ----------------------------------------------------------------

// ---- reminders ---------------------------------------------------------------

const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function relWhen(at, hasTime, now) {
  const days = daysUntil(ymdOf(at), now);
  const time = hasTime ? fmtTime(fmtNowHM(at)) : '';
  const mins = Math.round((at - now) / 60000);
  if (hasTime && mins >= 0 && mins < 60) return `in ${Math.max(1, mins)} min`;
  if (days <= 0) return time ? `today at ${time}` : 'today';
  if (days === 1) return time ? `tomorrow at ${time}` : 'tomorrow';
  return `in ${days} days (${fmtDate(ymdOf(at), false)}${time ? ', ' + time : ''})`;
}

function reminderInfo(r, now) {
  const m = r.match;
  switch (r.type) {
    case 'regOpens':
      return { tone: 'info', title: `Registration opens ${relWhen(r.at, !!m.regOpensTime, now)}` };
    case 'regOpen':
      return { tone: 'warn', title: 'Registration is open', sub: "You haven't marked this match registered yet." };
    case 'regCloses':
      return { tone: 'urgent', title: `Registration closes ${relWhen(r.at, !!m.regClosesTime, now)}` };
    default: {
      const today = daysUntil(m.startDate, now) <= 0;
      const title = today
        ? `Match day today${m.startTime ? ` · starts ${fmtTime(m.startTime)}` : ''}`
        : `Match ${relWhen(r.at, !!m.startTime, now)}`;
      return { tone: 'ok', title, sub: m.regStatus === 'waitlisted' ? "You're on the waitlist." : m.regStatus === 'interested' ? 'Not marked registered.' : '' };
    }
  }
}

function reminderCard(r, now) {
  const m = r.match;
  const info = reminderInfo(r, now);
  const isReg = r.type !== 'matchDay';
  const canMark = r.type === 'regOpen' || r.type === 'regCloses';
  return `<div class="reminder tone-${info.tone}">
    <a class="reminder-main" href="${href('match', m.id)}">
      <div class="reminder-title">${esc(info.title)}</div>
      <div class="reminder-match">${esc([m.name, m.club].filter(Boolean).join(' · '))}</div>
      ${info.sub ? `<div class="reminder-sub">${esc(info.sub)}</div>` : ''}
    </a>
    <div class="reminder-actions">
      ${isReg && m.regLink ? `<a class="btn small" href="${esc(m.regLink)}" target="_blank" rel="noopener noreferrer">Register ↗</a>` : ''}
      ${canMark ? `<button class="btn small" type="button" data-act="registered" data-id="${esc(m.id)}">Mark registered</button>` : ''}
      <button class="btn small quiet" type="button" data-act="dismiss" data-key="${esc(r.key)}">Dismiss</button>
    </div>
  </div>`;
}

// Recomputes reminders: updates the tab badge always, and the list when Upcoming is showing.
async function refreshReminders() {
  const [all, settings] = await Promise.all([store.list(), store.getSettings()]);
  const now = clock();
  const due = computeReminders(all, settings, now);

  const badge = document.getElementById('badge');
  badge.textContent = due.length;
  badge.hidden = !due.length;

  const box = document.getElementById('reminders');
  if (!box) return;
  box.innerHTML = due.length ? `
    <h3 class="section-label">Reminders</h3>
    <div class="list">${due.map((r) => reminderCard(r, now)).join('')}</div>
    <p class="fine">Shown while this app is open. No phone alerts are set up.</p>` : '';

  box.querySelectorAll('[data-act="dismiss"]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        const s = pruneDismissed(await store.getSettings(), all);
        s.dismissed[btn.dataset.key] = new Date().toISOString();
        await store.saveSettings(s);
        toast('Reminder dismissed');
        refreshReminders();
      } catch (err) { showError(err); }
    };
  });
  box.querySelectorAll('[data-act="registered"]').forEach((btn) => {
    btn.onclick = async () => {
      const m = all.find((x) => x.id === btn.dataset.id);
      if (!m) return;
      try {
        await store.save({ ...m, regStatus: 'registered' });
        toast('Marked Registered');
        renderUpcoming();
      } catch (err) { showError(err); }
    };
  });
}

// ---- screens ----------------------------------------------------------------

async function renderUpcoming() {
  const all = await store.list();
  const now = clock();
  const needsResult = all
    .filter((m) => isPast(m, now) && !m.result && m.regStatus !== 'not-going')
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  const upcoming = all.filter((m) => !isPast(m, now)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  view.innerHTML = `
    <div class="page-head">
      <h2>Upcoming</h2>
      <a class="btn primary" href="#new">+ Add match</a>
    </div>
    <div id="reminders"></div>
    ${needsResult.length ? `
      <h3 class="section-label">Add your result</h3>
      <div class="list">${needsResult.map((m) => matchCard(m, now, {
        link: href('result', m.id),
        meta: '<span class="pill pill-needs">Needs result</span><span class="when">Tap to add your score</span>',
      })).join('')}</div>
      <h3 class="section-label">Coming up</h3>` : ''}
    ${upcoming.length
      ? `<div class="list">${upcoming.map((m) => matchCard(m, now)).join('')}</div>`
      : `<div class="empty"><p>No upcoming matches yet.</p><p class="muted">Tap <strong>+ Add match</strong> to add one.</p></div>`}
  `;
  await refreshReminders();
}

// ---- progress (dashboard) -------------------------------------------------------

function resultCard(m) {
  const r = m.result;
  const sub = [m.sport, r.division, r.classification].filter(Boolean).join(' · ');
  const place = r.placeDivision
    ? `${ordinal(r.placeDivision)}${r.totalDivision ? ` of ${r.totalDivision}` : ''} in division`
    : r.placeOverall ? `${ordinal(r.placeOverall)}${r.totalOverall ? ` of ${r.totalOverall}` : ''} overall` : '';
  return `<a class="card match-card" href="${href('match', m.id)}">
    ${dateBox(m, { showYear: true })}
    <div class="card-body">
      <div class="card-title">${esc(m.name)}</div>
      ${sub ? `<div class="card-sub">${esc(sub)}</div>` : ''}
      ${place ? `<div class="card-sub">${esc(place)}</div>` : ''}
    </div>
    ${r.matchPct != null ? `<div class="pct">${r.matchPct.toFixed(2)}<small>%</small></div>` : ''}
  </a>`;
}

// The filter choice is a convenience, so it's remembered per device and never synced.
const FILTER_KEY = 'matchTracker.progressFilters.v1';
function loadFilters() {
  try { return JSON.parse(localStorage.getItem(FILTER_KEY)) || null; } catch { return null; }
}
function saveFilters(f) {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch { /* not important */ }
}

function statTile(label, value, delta = '') {
  return `<div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div>${delta}</div>`;
}

// delta: number; goodWhenUp says which direction is an improvement.
function deltaLine(delta, goodWhenUp, vsLabel, unit = '') {
  if (delta == null || Math.abs(delta) < 0.05) return delta == null ? '' : `<div class="stat-delta">No change vs ${esc(vsLabel)}</div>`;
  const up = delta > 0;
  const good = up === goodWhenUp;
  return `<div class="stat-delta ${good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}${unit} vs ${esc(vsLabel)}</div>`;
}

let chartObserver = null;

async function renderProgress() {
  const all = await store.list();
  const now = clock();
  const next = all
    .filter((m) => !isPast(m, now) && m.regStatus !== 'not-going')
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    .slice(0, 2);
  const hasResults = all.some((m) => m.result);

  view.innerHTML = `
    <div class="page-head"><h2>Progress</h2></div>

    <div class="section-row"><h3 class="section-label">Next up</h3><a class="small-link" href="#upcoming">All upcoming</a></div>
    ${next.length
      ? `<div class="list">${next.map((m) => matchCard(m, now)).join('')}</div>`
      : '<p class="muted">No upcoming matches. <a href="#new">Add one</a></p>'}

    <h3 class="section-label">Your results</h3>
    ${hasResults
      ? '<div class="filters" id="filters"></div><div id="progress-body"></div>'
      : `<div class="empty"><p>No results yet.</p><p class="muted">After a match, open it and tap <strong>Add result</strong>. Your trends show up here.</p></div>`}
  `;
  if (!hasResults) return;

  const thisYear = String(now.getFullYear());
  const saved = loadFilters();
  const f = saved || {
    season: all.some((m) => m.result && seasonOf(m) === thisYear) ? thisYear : 'all',
    sport: 'all',
    division: 'all',
  };

  const draw = () => {
    const opts = filterOptions(all, f);
    if (f.season !== 'all' && !opts.seasons.includes(f.season)) f.season = 'all';
    if (f.sport !== 'all' && !opts.sports.includes(f.sport)) f.sport = 'all';
    const divOpts = filterOptions(all, f).divisions;
    if (f.division !== 'all' && !divOpts.includes(f.division)) f.division = 'all';

    const select = (name, label, allLabel, values) => `<label class="filter">
      <span>${label}</span>
      <select data-filter="${name}">
        <option value="all">${allLabel}</option>
        ${values.map((v) => `<option value="${esc(v)}"${v === f[name] ? ' selected' : ''}>${esc(v)}</option>`).join('')}
      </select></label>`;

    view.querySelector('#filters').innerHTML =
      select('season', 'Season', 'All seasons', opts.seasons) +
      select('sport', 'Sport', 'All sports', opts.sports) +
      select('division', 'Division', 'All divisions', divOpts);

    view.querySelectorAll('[data-filter]').forEach((sel) => {
      sel.onchange = () => {
        f[sel.dataset.filter] = sel.value;
        if (sel.dataset.filter === 'sport') f.division = 'all';
        saveFilters(f);
        draw();
      };
    });

    const list = filterResults(all, f);
    const s = summarize(list);
    let prev = null;
    if (f.season !== 'all') prev = summarize(filterResults(all, { ...f, season: String(Number(f.season) - 1) }));
    const vs = String(Number(f.season) - 1);

    const body = view.querySelector('#progress-body');
    if (!list.length) {
      body.innerHTML = '<div class="empty"><p>No results match these filters.</p></div>';
      return;
    }

    const mixed = s.divisions.length > 1;
    body.innerHTML = `
      <div class="stats">
        ${statTile('Matches', String(s.count))}
        ${statTile('Average match %', s.avgPct != null ? s.avgPct.toFixed(1) + '%' : '—',
          prev && prev.avgPct != null && s.avgPct != null ? deltaLine(s.avgPct - prev.avgPct, true, vs, ' pts') : '')}
        ${statTile('Best match %', s.best ? s.best.result.matchPct.toFixed(2) + '%' : '—',
          s.best ? `<div class="stat-delta">${esc(s.best.name)}</div>` : '')}
        ${statTile('Penalties per match', s.penaltiesPerMatch != null ? s.penaltiesPerMatch.toFixed(1) : '—',
          prev && prev.penaltiesPerMatch != null && s.penaltiesPerMatch != null ? deltaLine(s.penaltiesPerMatch - prev.penaltiesPerMatch, false, vs) : '')}
      </div>

      <section class="panel chart-panel">
        <h3>Match % over time</h3>
        ${mixed ? '<p class="fine">These results mix divisions or sports. Pick one division to compare like with like.</p>' : ''}
        <div class="chart" id="pct-chart"></div>
      </section>

      <h3 class="section-label">${s.count} result${s.count === 1 ? '' : 's'}</h3>
      <div class="list">${[...list].reverse().map(resultCard).join('')}</div>
    `;

    const points = list
      .filter((m) => m.result.matchPct != null)
      .map((m) => ({ date: parseYMD(m.startDate), pct: m.result.matchPct, name: m.name, division: [m.sport, m.result.division].filter(Boolean).join(' · ') }));
    const chartEl = body.querySelector('#pct-chart');
    drawPctChart(chartEl, points);
    chartObserver?.disconnect();
    let lastW = chartEl.clientWidth;
    chartObserver = new ResizeObserver(() => {
      if (!chartEl.isConnected) { chartObserver.disconnect(); return; }
      if (chartEl.clientWidth !== lastW) { lastW = chartEl.clientWidth; drawPctChart(chartEl, points); }
    });
    chartObserver.observe(chartEl);
  };

  draw();
}

// Line chart of match % by date. Single series, so no legend: the heading names it.
// Hover / tap / arrow keys show a tooltip; the results list below is the table view.
function drawPctChart(el, points) {
  el.textContent = '';
  if (points.length < 2) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = points.length
      ? 'Add one more result with a match % to see a trend.'
      : 'No match % recorded for these results yet.';
    el.appendChild(p);
    return;
  }

  const NS = 'http://www.w3.org/2000/svg';
  const W = Math.max(260, el.clientWidth);
  const H = 220;
  const pad = { top: 22, right: 14, bottom: 28, left: 34 };
  const DAY = 86400000;

  let x0 = points[0].date.getTime();
  let x1 = points[points.length - 1].date.getTime();
  if (x1 - x0 < 30 * DAY) { const mid = (x0 + x1) / 2; x0 = mid - 15 * DAY; x1 = mid + 15 * DAY; }
  const pcts = points.map((p) => p.pct);
  let y0 = Math.max(0, Math.floor((Math.min(...pcts) - 5) / 10) * 10);
  let y1 = Math.min(100, Math.ceil((Math.max(...pcts) + 5) / 10) * 10);
  if (y1 - y0 < 20) { if (y1 < 100) y1 = Math.min(100, y0 + 20); else y0 = Math.max(0, y1 - 20); }
  const yStep = y1 - y0 > 50 ? 20 : 10;

  const sx = (t) => pad.left + ((t - x0) / (x1 - x0)) * (W - pad.left - pad.right);
  const sy = (v) => pad.top + (1 - (v - y0) / (y1 - y0)) * (H - pad.top - pad.bottom);
  const mk = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    parent?.appendChild(n);
    return n;
  };

  const first = points[0];
  const last = points[points.length - 1];
  const svg = mk('svg', {
    viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart-svg', tabindex: '0', role: 'img',
    'aria-label': `Match percent over time: ${points.length} matches, from ${first.pct.toFixed(1)}% to ${last.pct.toFixed(1)}%. Use left and right arrow keys to step through matches.`,
  });

  // Gridlines + y labels
  for (let v = Math.ceil(y0 / yStep) * yStep; v <= y1; v += yStep) {
    mk('line', { x1: pad.left, x2: W - pad.right, y1: sy(v), y2: sy(v), class: 'grid' }, svg);
    mk('text', { x: pad.left - 6, y: sy(v) + 4, 'text-anchor': 'end', class: 'tick' }, svg).textContent = `${v}%`;
  }

  // X labels: first of month, thinned so they don't collide
  const months = [];
  const d = new Date(x0); d.setDate(1); d.setHours(0, 0, 0, 0);
  if (d.getTime() < x0) d.setMonth(d.getMonth() + 1);
  while (d.getTime() <= x1) { months.push(new Date(d)); d.setMonth(d.getMonth() + 1); }
  const maxLabels = Math.max(2, Math.floor((W - pad.left - pad.right) / 64));
  const every = Math.max(1, Math.ceil(months.length / maxLabels));
  const multiYear = new Date(x0).getFullYear() !== new Date(x1).getFullYear();
  months.filter((_, i) => i % every === 0).forEach((m) => {
    const label = m.toLocaleDateString(undefined, { month: 'short' }) + (multiYear ? ` '${String(m.getFullYear()).slice(2)}` : '');
    mk('text', { x: sx(m.getTime()), y: H - 8, 'text-anchor': 'middle', class: 'tick' }, svg).textContent = label;
  });
  mk('line', { x1: pad.left, x2: W - pad.right, y1: H - pad.bottom, y2: H - pad.bottom, class: 'axis' }, svg);

  // Line + dots
  const pts = points.map((p) => [sx(p.date.getTime()), sy(p.pct)]);
  mk('path', { d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(''), class: 'series-line' }, svg);
  const cross = mk('line', { y1: pad.top, y2: H - pad.bottom, class: 'crosshair', visibility: 'hidden' }, svg);
  const dots = pts.map(([x, y]) => mk('circle', { cx: x, cy: y, r: 4, class: 'series-dot' }, svg));

  // Label only the latest value
  const [lx, ly] = pts[pts.length - 1];
  mk('text', { x: lx, y: ly - 10, 'text-anchor': lx > W - 40 ? 'end' : 'middle', class: 'end-label' }, svg).textContent = `${last.pct.toFixed(1)}%`;

  el.appendChild(svg);

  // Tooltip
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  const tVal = document.createElement('strong');
  const tName = document.createElement('div');
  const tSub = document.createElement('div');
  tSub.className = 'muted';
  tip.append(tVal, tName, tSub);
  el.appendChild(tip);

  let active = -1;
  const show = (i) => {
    active = i;
    const p = points[i];
    const [x, y] = pts[i];
    dots.forEach((c, j) => c.setAttribute('r', j === i ? 6 : 4));
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    tVal.textContent = `${p.pct.toFixed(2)}%`;
    tName.textContent = p.name;
    tSub.textContent = [fmtDate(ymdOf(p.date)), p.division].filter(Boolean).join(' · ');
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(0, x - tw / 2), W - tw)}px`;
    tip.style.top = `${Math.max(0, y - tip.offsetHeight - 14)}px`;
  };
  const hide = () => {
    active = -1;
    dots.forEach((c) => c.setAttribute('r', 4));
    cross.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  const nearest = (evt) => {
    const box = svg.getBoundingClientRect();
    const x = ((evt.clientX - box.left) / box.width) * W;
    let best = 0;
    pts.forEach(([px], i) => { if (Math.abs(px - x) < Math.abs(pts[best][0] - x)) best = i; });
    return best;
  };
  svg.addEventListener('pointermove', (e) => show(nearest(e)));
  svg.addEventListener('pointerdown', (e) => show(nearest(e)));
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const i = active < 0 ? points.length - 1 : active + (e.key === 'ArrowRight' ? 1 : -1);
      show(Math.min(points.length - 1, Math.max(0, i)));
    } else if (e.key === 'Escape') hide();
  });
}

async function renderDetail(id) {
  const m = await store.get(id);
  if (!m) return renderNotFound();
  const now = clock();
  const r = m.result;

  const facts = (rows) => `<dl class="facts">${rows.filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  const link = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`;

  const resultHtml = r ? `
      ${facts([
        ['Division', esc(r.division)],
        ['Class', esc(r.classification)],
        ['Match %', r.matchPct != null ? esc(r.matchPct.toFixed(2) + '%') : ''],
        ['Division place', r.placeDivision ? esc(ordinal(r.placeDivision) + (r.totalDivision ? ` of ${r.totalDivision}` : '')) : ''],
        ['Overall place', r.placeOverall ? esc(ordinal(r.placeOverall) + (r.totalOverall ? ` of ${r.totalOverall}` : '')) : ''],
        ['Points', r.points != null ? esc(String(r.points)) : ''],
        ['Penalties', r.penalties != null ? esc(String(r.penalties)) : ''],
        ['Official results', r.resultsLink ? link(r.resultsLink, 'Open results ↗') : ''],
      ])}
      ${r.notes ? `<p class="prewrap">${esc(r.notes)}</p>` : ''}
      <a class="btn" href="${href('result', m.id)}">Edit result</a>`
    : hasStarted(m, now)
      ? `<a class="btn primary" href="${href('result', m.id)}">Add result</a>`
      : '<p class="muted">You can add your result once the match starts.</p>';

  view.innerHTML = `
    <div class="page-head"><button class="link-btn" id="back" type="button">‹ Back</button></div>
    <h2 class="detail-title">${esc(m.name)}</h2>
    <p class="muted">${esc([m.sport, m.club].filter(Boolean).join(' · '))}</p>

    <section class="panel">
      ${facts([
        ['When', esc(fmtWhen(m)) + (isPast(m, now) ? '' : ` <span class="muted">(${esc(relativeDay(m, now))})</span>`)],
        ['Where', m.location ? `${esc(m.location)}<br>${link('https://maps.apple.com/?q=' + encodeURIComponent(m.location), 'Directions ↗')}` : ''],
      ])}
    </section>

    <section class="panel">
      <h3>Registration</h3>
      <div class="segmented" role="group" aria-label="Registration status">
        ${REG_STATUSES.map((s) => `<button type="button" data-status="${s.value}" aria-pressed="${m.regStatus === s.value}">${s.label}</button>`).join('')}
      </div>
      ${facts([
        ['Opens', esc(fmtDateTime(m.regOpensDate, m.regOpensTime))],
        ['Closes', esc(fmtDateTime(m.regClosesDate, m.regClosesTime))],
        ['Fee', esc(fmtMoney(m.fee))],
      ])}
      ${m.regLink ? `<a class="btn" href="${esc(m.regLink)}" target="_blank" rel="noopener noreferrer">Open registration page ↗</a>` : ''}
    </section>

    <section class="panel">
      <h3>Result</h3>
      ${resultHtml}
    </section>

    ${m.notes ? `<section class="panel"><h3>Notes</h3><p class="prewrap">${esc(m.notes)}</p></section>` : ''}

    <div class="actions">
      <a class="btn" href="${href('edit', m.id)}">Edit match</a>
      <button class="btn danger" id="delete" type="button">Delete match</button>
    </div>
  `;

  view.querySelector('#back').onclick = () => goBack(r ? '#progress' : '#upcoming');

  view.querySelectorAll('[data-status]').forEach((btn) => {
    btn.onclick = async () => {
      if (btn.dataset.status === m.regStatus) return;
      try {
        await store.save({ ...m, regStatus: btn.dataset.status });
        toast(`Marked ${statusLabel(btn.dataset.status)}`);
        renderDetail(id);
        refreshReminders();
      } catch (err) { showError(err); }
    };
  });

  view.querySelector('#delete').onclick = async () => {
    if (!confirm(`Delete "${m.name}"${r ? ' and its result' : ''}? This can't be undone.`)) return;
    try {
      await store.remove(m.id);
      toast('Match deleted');
      location.hash = r ? '#progress' : '#upcoming';
    } catch (err) { showError(err); }
  };
}

// ---- forms --------------------------------------------------------------------

function field({ name, label, value = '', type = 'text', required = false, hint = '', attrs = '' }) {
  return `<label class="field">
    <span class="label">${label}${required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</span>
    <input name="${name}" type="${type}" value="${esc(value ?? '')}" ${required ? 'required' : ''} ${attrs}>
    ${hint ? `<span class="hint">${hint}</span>` : ''}
    <span class="err" data-err="${name}"></span>
  </label>`;
}

function selectField({ name, label, value, options }) {
  return `<label class="field">
    <span class="label">${label}</span>
    <select name="${name}">${options.map(([v, t]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
  </label>`;
}

function textareaField({ name, label, value = '' }) {
  return `<label class="field">
    <span class="label">${label}</span>
    <textarea name="${name}" rows="3">${esc(value)}</textarea>
  </label>`;
}

const datalist = (id, items) =>
  `<datalist id="${id}">${[...new Set(items.filter(Boolean))].sort().map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;

function showErrors(form, errors) {
  form.querySelectorAll('[data-err]').forEach((el) => {
    el.textContent = errors[el.dataset.err] || '';
    el.closest('.field')?.classList.toggle('has-error', !!errors[el.dataset.err]);
  });
  const first = Object.keys(errors)[0];
  if (first) form.elements[first]?.focus();
}

// fromClubId: start a new match pre-filled from a saved club (Discover → "Add match").
async function renderMatchForm(id, fromClubId = null) {
  const [all, clubs] = await Promise.all([store.list(), store.listClubs()]);
  const existing = id ? all.find((m) => m.id === id) : null;
  if (id && !existing) return renderNotFound();
  const fromClub = fromClubId ? clubs.find((c) => c.id === fromClubId) : null;
  const m = existing || normalizeMatch(fromClub
    ? { club: fromClub.name, location: fromClub.location, sport: fromClub.sports[0] }
    : {});
  const sports = SPORTS.includes(m.sport) ? SPORTS : [...SPORTS, m.sport];

  view.innerHTML = `
    <div class="page-head"><h2>${existing ? 'Edit match' : 'Add match'}</h2></div>
    <form id="f" class="form" novalidate>
      ${field({ name: 'name', label: 'Match name', value: m.name, required: true, attrs: 'autocomplete="off"' })}
      ${selectField({ name: 'sport', label: 'Sport', value: m.sport, options: sports.map((s) => [s, s]) })}
      ${field({ name: 'club', label: 'Club', value: m.club, attrs: 'list="clubs" autocomplete="off"' })}
      ${field({ name: 'location', label: 'Location', value: m.location, hint: 'Range name or address, for directions.', attrs: 'list="locations" autocomplete="off"' })}

      <fieldset><legend>Match day</legend>
        <div class="row">
          ${field({ name: 'startDate', label: 'Date', type: 'date', value: m.startDate, required: true })}
          ${field({ name: 'startTime', label: 'Start time', type: 'time', value: m.startTime })}
        </div>
        ${field({ name: 'endDate', label: 'Last day (multi-day matches only)', type: 'date', value: m.endDate })}
      </fieldset>

      <fieldset><legend>Registration</legend>
        <div class="row">
          ${field({ name: 'regOpensDate', label: 'Opens', type: 'date', value: m.regOpensDate })}
          ${field({ name: 'regOpensTime', label: 'Time', type: 'time', value: m.regOpensTime })}
        </div>
        <div class="row">
          ${field({ name: 'regClosesDate', label: 'Closes', type: 'date', value: m.regClosesDate })}
          ${field({ name: 'regClosesTime', label: 'Time', type: 'time', value: m.regClosesTime })}
        </div>
        ${field({ name: 'regLink', label: 'Registration link', type: 'url', value: m.regLink, hint: 'Paste the PractiScore or club page address.', attrs: 'inputmode="url" autocomplete="off" autocapitalize="off"' })}
        <div class="row">
          ${field({ name: 'fee', label: 'Fee ($)', type: 'number', value: m.fee, attrs: 'inputmode="decimal" min="0" step="any"' })}
          ${selectField({ name: 'regStatus', label: 'Status', value: m.regStatus, options: REG_STATUSES.map((s) => [s.value, s.label]) })}
        </div>
      </fieldset>

      ${textareaField({ name: 'notes', label: 'Notes', value: m.notes })}

      ${datalist('clubs', [...clubs.map((c) => c.name), ...all.map((x) => x.club)])}
      ${datalist('locations', [...clubs.map((c) => c.location), ...all.map((x) => x.location)])}

      <div class="form-actions">
        <button class="btn primary" type="submit">Save</button>
        <button class="btn" type="button" id="cancel">Cancel</button>
      </div>
    </form>
  `;

  const form = view.querySelector('#f');
  view.querySelector('#cancel').onclick = () => goBack(existing ? href('match', id) : fromClub ? '#discover' : '#upcoming');

  // Picking a saved club fills in its location if that's still empty.
  form.elements.club.addEventListener('change', () => {
    const c = clubs.find((x) => x.name.toLowerCase() === form.elements.club.value.trim().toLowerCase());
    if (c && c.location && !form.elements.location.value.trim()) form.elements.location.value = c.location;
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const next = normalizeMatch({ ...m, ...data });
    const errors = validateMatch(next);
    showErrors(form, errors);
    if (Object.keys(errors).length) return;
    try {
      const saved = await store.save(next);
      toast('Saved');
      location.replace(href('match', saved.id));
    } catch (err) { showError(err); }
  };
}

async function renderResultForm(id) {
  const all = await store.list();
  const m = all.find((x) => x.id === id);
  if (!m) return renderNotFound();

  // New result: start from the last division/class used in the same sport.
  const lastSame = all
    .filter((x) => x.result && x.sport === m.sport && x.id !== m.id)
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)))[0];
  const r = m.result || normalizeResult({
    division: lastSame?.result.division, classification: lastSame?.result.classification,
  });
  const sameSport = all.filter((x) => x.result && x.sport === m.sport);

  view.innerHTML = `
    <div class="page-head"><h2>${m.result ? 'Edit result' : 'Add result'}</h2></div>
    <p class="muted">${esc(m.name)} · ${esc(fmtDate(m.startDate))}</p>
    <form id="f" class="form" novalidate>
      <div class="row">
        ${field({ name: 'division', label: 'Division', value: r.division, attrs: 'list="divs" autocomplete="off"' })}
        ${field({ name: 'classification', label: 'Class', value: r.classification, attrs: 'list="classes" autocomplete="off"' })}
      </div>
      ${field({ name: 'matchPct', label: 'Match %', type: 'number', value: r.matchPct, attrs: 'inputmode="decimal" min="0" max="100" step="any"' })}
      <div class="row">
        ${field({ name: 'placeDivision', label: 'Division place', type: 'number', value: r.placeDivision, attrs: 'inputmode="numeric" min="1" step="1"' })}
        ${field({ name: 'totalDivision', label: 'of', type: 'number', value: r.totalDivision, attrs: 'inputmode="numeric" min="1" step="1"' })}
      </div>
      <div class="row">
        ${field({ name: 'placeOverall', label: 'Overall place', type: 'number', value: r.placeOverall, attrs: 'inputmode="numeric" min="1" step="1"' })}
        ${field({ name: 'totalOverall', label: 'of', type: 'number', value: r.totalOverall, attrs: 'inputmode="numeric" min="1" step="1"' })}
      </div>
      <div class="row">
        ${field({ name: 'points', label: 'Points', type: 'number', value: r.points, attrs: 'inputmode="decimal" step="any"' })}
        ${field({ name: 'penalties', label: 'Penalties', type: 'number', value: r.penalties, hint: 'Total count', attrs: 'inputmode="numeric" min="0" step="1"' })}
      </div>
      ${field({ name: 'resultsLink', label: 'Official results link', type: 'url', value: r.resultsLink, attrs: 'inputmode="url" autocomplete="off" autocapitalize="off"' })}
      ${textareaField({ name: 'notes', label: 'Notes (what went well, what to work on)', value: r.notes })}

      ${datalist('divs', [...(DIVISION_SUGGESTIONS[m.sport] || []), ...sameSport.map((x) => x.result.division)])}
      ${datalist('classes', [...(CLASS_SUGGESTIONS[m.sport] || []), ...sameSport.map((x) => x.result.classification)])}

      <div class="form-actions">
        <button class="btn primary" type="submit">Save result</button>
        <button class="btn" type="button" id="cancel">Cancel</button>
      </div>
      ${m.result ? '<button class="btn danger wide" type="button" id="remove">Remove result</button>' : ''}
    </form>
  `;

  const form = view.querySelector('#f');
  view.querySelector('#cancel').onclick = () => goBack(href('match', id));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const next = normalizeResult(Object.fromEntries(new FormData(form)));
    const errors = validateResult(next);
    showErrors(form, errors);
    if (Object.keys(errors).length) return;
    try {
      await store.save({ ...m, result: next });
      toast('Result saved');
      location.replace(href('match', id));
    } catch (err) { showError(err); }
  };
  const remove = view.querySelector('#remove');
  if (remove) {
    remove.onclick = async () => {
      if (!confirm('Remove this result? The match itself stays.')) return;
      try {
        await store.save({ ...m, result: null });
        toast('Result removed');
        location.replace(href('match', id));
      } catch (err) { showError(err); }
    };
  }
}

// ---- discover: where to find matches + saved clubs ---------------------------

const directionsUrl = (place) => 'https://maps.apple.com/?daddr=' + encodeURIComponent(place);

function clubCard(c) {
  const ext = (url, text) => `<a class="btn small" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  return `<div class="card club-card">
    <div class="card-body">
      <div class="card-title">${c.favorite ? '<span class="star" title="Favorite" aria-label="Favorite">★</span> ' : ''}${esc(c.name)}</div>
      ${c.sports.length ? `<div class="card-sub">${esc(c.sports.join(' · '))}</div>` : ''}
      ${c.location ? `<div class="card-sub">${esc(c.location)}</div>` : ''}
      <div class="card-meta"><span class="when">${c.miles != null ? `${esc(String(c.miles))} mi from home` : 'Distance not set'}</span></div>
      <div class="reminder-actions">
        ${c.link ? ext(c.link, 'Website ↗') : ''}
        ${c.location ? ext(directionsUrl(c.location), 'Directions ↗') : ''}
        <a class="btn small" href="${href('new', 'club', c.id)}">Add match</a>
        <a class="btn small quiet" href="${href('club', c.id)}">Edit</a>
      </div>
    </div>
  </div>`;
}

async function renderDiscover() {
  const [clubs, settings] = await Promise.all([store.listClubs(), store.getSettings()]);
  const radius = settings.travelRadius;
  const sorted = [...clubs].sort((a, b) =>
    (b.favorite - a.favorite) || ((a.miles ?? Infinity) - (b.miles ?? Infinity)) || a.name.localeCompare(b.name));
  const shown = radius == null ? sorted : sorted.filter((c) => c.miles == null || c.miles <= radius);
  const hidden = sorted.length - shown.length;
  const unchecked = MATCH_SOURCES.flatMap((g) => g.links).filter((l) => !l.checked);

  view.innerHTML = `
    <div class="page-head"><h2>Discover</h2></div>
    <p class="muted">Find matches on these official sites, then save the ones you want with <a href="#new">+ Add match</a>. Listings aren't pulled in automatically, because none of these sites offers a way to do that.</p>

    <h3 class="section-label">Search for matches</h3>
    <div class="source-groups">
      ${MATCH_SOURCES.map((g) => `<section class="panel source-group">
        <h3>${esc(g.group)}</h3>
        ${g.links.map((l) => `<a class="source-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
          <span class="source-title">${esc(l.title)} ↗</span>
          ${l.note ? `<span class="source-note">${esc(l.note)}</span>` : ''}
        </a>`).join('')}
      </section>`).join('')}
    </div>
    <p class="fine">Links checked ${esc(fmtDate(LINKS_CHECKED))}.${unchecked.length
      ? ` ${unchecked.map((l) => esc(l.title)).join(', ')} couldn't be checked automatically.` : ''}</p>

    <div class="section-row"><h3 class="section-label">My clubs</h3><a class="small-link" href="#club/new">+ Add club</a></div>
    ${clubs.length ? `
      <label class="filter radius-filter"><span>Show clubs within</span>
        <select id="radius">${RADIUS_OPTIONS.map((r) =>
          `<option value="${r ?? 'any'}"${r === radius ? ' selected' : ''}>${r == null ? 'Any distance' : `${r} miles of home`}</option>`).join('')}
        </select>
      </label>
      <div class="list">${shown.map(clubCard).join('')}</div>
      ${hidden ? `<p class="fine">${hidden} club${hidden === 1 ? '' : 's'} farther than ${radius} miles not shown.</p>` : ''}`
    : `<div class="empty"><p>No clubs saved yet.</p><p class="muted">Use the club finders above, then tap <strong>+ Add club</strong> to keep the ones you like here.</p></div>`}
  `;

  const sel = view.querySelector('#radius');
  if (sel) {
    sel.onchange = async () => {
      try {
        await store.saveSettings({ ...(await store.getSettings()), travelRadius: sel.value === 'any' ? null : Number(sel.value) });
        renderDiscover();
      } catch (err) { showError(err); }
    };
  }
}

async function renderClubForm(id) {
  const existing = id ? await store.getClub(id) : null;
  if (id && !existing) return renderNotFound();
  const c = existing || normalizeClub({});
  const sportChoices = [...new Set([...SPORTS, ...c.sports])];

  view.innerHTML = `
    <div class="page-head"><h2>${existing ? 'Edit club' : 'Add club'}</h2></div>
    <form id="f" class="form" novalidate>
      ${field({ name: 'name', label: 'Club name', value: c.name, required: true, attrs: 'autocomplete="off"' })}
      <fieldset><legend>Sports they run</legend>
        <div class="checks">${sportChoices.map((s) => `<label class="check">
          <input type="checkbox" name="sports" value="${esc(s)}"${c.sports.includes(s) ? ' checked' : ''}> ${esc(s)}</label>`).join('')}
        </div>
      </fieldset>
      ${field({ name: 'location', label: 'Range address or town', value: c.location, hint: 'Used for directions and filled into new matches.', attrs: 'autocomplete="off"' })}
      ${field({ name: 'miles', label: 'Miles from home', type: 'number', value: c.miles, hint: 'Driving miles. Save the address, then use Directions to check.', attrs: 'inputmode="decimal" min="0" step="any"' })}
      ${field({ name: 'link', label: 'Website or PractiScore club page', type: 'url', value: c.link, attrs: 'inputmode="url" autocomplete="off" autocapitalize="off"' })}
      ${textareaField({ name: 'notes', label: 'Notes (match days, contact, what to bring)', value: c.notes })}
      <label class="check"><input type="checkbox" name="favorite"${c.favorite ? ' checked' : ''}> Favorite (shows first)</label>

      <div class="form-actions">
        <button class="btn primary" type="submit">Save club</button>
        <button class="btn" type="button" id="cancel">Cancel</button>
      </div>
      ${existing ? '<button class="btn danger wide" type="button" id="remove">Delete club</button>' : ''}
    </form>
  `;

  const form = view.querySelector('#f');
  view.querySelector('#cancel').onclick = () => goBack('#discover');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const next = normalizeClub({
      ...c,
      ...Object.fromEntries(fd),
      sports: fd.getAll('sports'),
      favorite: fd.has('favorite'),
    });
    const errors = validateClub(next);
    showErrors(form, errors);
    if (Object.keys(errors).length) return;
    try {
      await store.saveClub(next);
      toast('Club saved');
      location.replace('#discover');
    } catch (err) { showError(err); }
  };
  const remove = view.querySelector('#remove');
  if (remove) {
    remove.onclick = async () => {
      if (!confirm(`Delete "${c.name}" from your clubs? Matches you've saved stay.`)) return;
      try {
        await store.removeClub(c.id);
        toast('Club deleted');
        location.replace('#discover');
      } catch (err) { showError(err); }
    };
  }
}

// ---- settings: reminders + data (backup / restore) ----------------------------

async function renderSettings() {
  const [all, clubs, settings] = await Promise.all([store.list(), store.listClubs(), store.getSettings()]);
  const withResults = all.filter((m) => m.result).length;
  const dismissedCount = Object.keys(pruneDismissed(settings, all).dismissed).length;

  view.innerHTML = `
    <div class="page-head"><h2>Settings</h2></div>

    <section class="panel">
      <h3>Reminders</h3>
      <p class="muted">Reminders appear at the top of Upcoming, with a count on the Upcoming tab, whenever this app is open. They don't send phone notifications, texts or emails, and nothing alerts you while the app is closed.</p>
      <div class="form">
        ${REMINDER_KINDS.map((k) => `<label class="field">
          <span class="label">${esc(k.label)}</span>
          <select data-lead="${k.key}">${LEAD_OPTIONS.map(([v, t]) =>
            `<option value="${v ?? 'off'}"${v === settings.leads[k.key] ? ' selected' : ''}>${t}</option>`).join('')}</select>
          <span class="hint">${esc(k.help)}</span>
        </label>`).join('')}
      </div>
      ${dismissedCount ? `<button class="btn wide" id="undismiss" type="button">Show ${dismissedCount} dismissed reminder${dismissedCount === 1 ? '' : 's'} again</button>` : ''}
    </section>

    <section class="panel">
      <h3>Your data</h3>
      <p><strong>${all.length}</strong> match${all.length === 1 ? '' : 'es'}, <strong>${withResults}</strong> with results, <strong>${clubs.length}</strong> saved club${clubs.length === 1 ? '' : 's'}.</p>
      <p class="muted">Right now your data is saved only in this browser on this device. It does not sync between your phone and laptop yet, and it is not sent anywhere. Export a backup now and then so you have a copy you can restore.</p>
    </section>

    <section class="panel">
      <h3>Back up</h3>
      <p class="muted">Saves everything to one file (.json). Keep it somewhere safe, like iCloud Drive or OneDrive.</p>
      <button class="btn primary" id="export" type="button"${all.length || clubs.length ? '' : ' disabled'}>Export backup</button>
    </section>

    <section class="panel">
      <h3>Restore</h3>
      <p class="muted">Replaces everything on this device with the contents of a backup file.</p>
      <label class="btn file-btn">Choose backup file…
        <input id="import" type="file" accept=".json,application/json">
      </label>
      ${store.hasUndoRestore() ? '<button class="btn" id="undo" type="button">Undo last restore</button>' : ''}
    </section>
  `;

  view.querySelectorAll('[data-lead]').forEach((sel) => {
    sel.onchange = async () => {
      try {
        const s = await store.getSettings();
        s.leads[sel.dataset.lead] = sel.value === 'off' ? null : Number(sel.value);
        await store.saveSettings(s);
        toast('Reminder setting saved');
        refreshReminders();
      } catch (err) { showError(err); }
    };
  });

  const undismiss = view.querySelector('#undismiss');
  if (undismiss) {
    undismiss.onclick = async () => {
      try {
        await store.saveSettings({ ...(await store.getSettings()), dismissed: {} });
        toast('Dismissed reminders restored');
        renderSettings();
        refreshReminders();
      } catch (err) { showError(err); }
    };
  }

  view.querySelector('#export').onclick = () => {
    const blob = new Blob([JSON.stringify(buildBackup(all, clubs), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    a.href = URL.createObjectURL(blob);
    a.download = `match-tracker-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Backup exported');
  };

  view.querySelector('#import').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { records, clubs: backupClubs, skipped } = parseBackup(await file.text());
      const skipNote = skipped.length
        ? `\n\n${skipped.length} record(s) in the file have problems and will be left out:\n` +
          skipped.slice(0, 5).map((s) => `• ${s.name}: ${s.reason}`).join('\n')
        : '';
      const clubNote = backupClubs
        ? ` and the ${clubs.length} saved club(s) with ${backupClubs.length}`
        : ' (this backup has no clubs, so your saved clubs stay as they are)';
      const ok = confirm(
        `Replace the ${all.length} match(es) on this device with ${records.length} from "${file.name}"${clubNote}?${skipNote}\n\nYou can undo this right after.`,
      );
      if (!ok) return;
      await store.replaceAll(records, backupClubs);
      toast(`Restored ${records.length} match${records.length === 1 ? '' : 'es'}`);
      renderSettings();
      refreshReminders();
    } catch (err) {
      alert(err.message);
    }
  };

  const undo = view.querySelector('#undo');
  if (undo) {
    undo.onclick = async () => {
      if (!confirm('Put back the data from before the last restore?')) return;
      try {
        await store.undoRestore();
        toast('Restore undone');
        renderSettings();
        refreshReminders();
      } catch (err) { showError(err); }
    };
  }
}

function renderNotFound() {
  view.innerHTML = `<div class="empty"><p>That match wasn't found. It may have been deleted.</p>
    <a class="btn" href="#upcoming">Back to Upcoming</a></div>`;
}

// ---- router -------------------------------------------------------------------

const routes = [
  [/^#upcoming$/, renderUpcoming, 'upcoming'],
  [/^#progress$/, renderProgress, 'progress'],
  [/^#results$/, () => location.replace('#progress')], // old address from step 1
  [/^#settings$/, renderSettings, 'settings'],
  [/^#data$/, () => location.replace('#settings')], // old address from step 1
  [/^#discover$/, renderDiscover, 'discover'],
  [/^#club\/new$/, () => renderClubForm(null)],
  [/^#club\/([^/]+)$/, renderClubForm],
  [/^#new$/, () => renderMatchForm(null)],
  [/^#new\/club\/([^/]+)$/, (clubId) => renderMatchForm(null, clubId)],
  [/^#match\/([^/]+)$/, renderDetail],
  [/^#edit\/([^/]+)$/, renderMatchForm],
  [/^#result\/([^/]+)$/, renderResultForm],
];

async function route() {
  const hash = location.hash || '#upcoming';
  const hit = routes.find(([re]) => re.test(hash));
  if (!hit) {
    location.replace('#upcoming');
    return;
  }
  const [re, render, tab] = hit;
  navCount += 1;
  if (tab) {
    document.querySelectorAll('.tabbar a').forEach((a) => {
      a.toggleAttribute('aria-current', a.dataset.tab === tab);
    });
  }
  try {
    await render(...hash.match(re).slice(1).map(decodeURIComponent));
    if (render !== renderUpcoming) await refreshReminders(); // keeps the tab badge current
  } catch (err) {
    showError(err);
  }
  window.scrollTo(0, 0);
}

if (!store.isAvailable()) {
  showBanner("This browser is blocking storage (private browsing?), so changes can't be saved here.");
} else if (TEST_NOW) {
  showBanner(`Test clock: acting as if it's ${TEST_NOW.toLocaleString()}. Remove "?now=…" from the address to use the real time.`);
}
window.addEventListener('hashchange', route);

// While the app is open, check reminders every minute. When it comes back to the
// screen (e.g. reopened on the phone), redraw Upcoming so "in N days" is current.
setInterval(() => {
  if (!document.hidden) refreshReminders().catch(console.error);
}, 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if ((location.hash || '#upcoming') === '#upcoming') renderUpcoming().catch(showError);
  else refreshReminders().catch(console.error);
});

route();

// Offline support + keeping the app current (see sw.js).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Offline support unavailable:', err));
}
