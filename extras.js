/* Timers, gap analysis, stats, streaks and calendar export.
   These lean on `db`, `save`, `keyOf`, `addDays`, `tasksFor`, `isDone` and
   `styleOf` from app.js / categories.js, so they're only ever called after
   app.js has run. */
'use strict';

const MAX_RUN = 12 * 3600;   // nobody works 12 hours straight; treat longer as a forgotten timer

/* ---------- time formatting ---------- */

function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h ? h + ':' + p(m) + ':' + p(r) : m + ':' + p(r);
}

function fmtSpan(mins) {
  const m = Math.round(mins);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60), r = m % 60;
  return r ? h + 'h ' + r + 'm' : h + 'h';
}

/* ---------- timers ---------- */

function logFor(dateKey) {
  db.log[dateKey] = db.log[dateKey] || {};
  return db.log[dateKey];
}

function logEntry(id, dateKey) {
  const l = logFor(dateKey);
  l[id] = l[id] || { spent: 0, startedAt: null };
  return l[id];
}

/* seconds tracked against a task on a given day, including any run in progress */
function elapsed(id, dateKey) {
  const e = (db.log[dateKey] || {})[id];
  if (!e) return 0;
  return e.spent + (e.startedAt ? Math.floor((Date.now() - e.startedAt) / 1000) : 0);
}

const isRunning = (id, dateKey) => !!((db.log[dateKey] || {})[id] || {}).startedAt;

/* the one task currently being timed, if any */
function runningTask() {
  for (const k of Object.keys(db.log)) {
    for (const id of Object.keys(db.log[k])) {
      if (db.log[k][id].startedAt) return { id: id, dateKey: k };
    }
  }
  return null;
}

function stopAllTimers() {
  let changed = false;
  for (const k of Object.keys(db.log)) {
    for (const id of Object.keys(db.log[k])) {
      const e = db.log[k][id];
      if (!e.startedAt) continue;
      e.spent += Math.min(Math.floor((Date.now() - e.startedAt) / 1000), MAX_RUN);
      e.startedAt = null;
      changed = true;
    }
  }
  if (changed) save();
  return changed;
}

/* only ever one timer at a time — starting a task stops whatever was running */
function startTimer(id, dateKey) {
  stopAllTimers();
  logEntry(id, dateKey).startedAt = Date.now();
  save();
}

function toggleTimer(id, dateKey) {
  if (isRunning(id, dateKey)) stopAllTimers();
  else startTimer(id, dateKey);
}

/* a timer left running overnight is a mistake, not twelve hours of work */
function sanitizeTimers() {
  let changed = false;
  for (const k of Object.keys(db.log || {})) {
    for (const id of Object.keys(db.log[k])) {
      const e = db.log[k][id];
      if (e.startedAt && Date.now() - e.startedAt > MAX_RUN * 1000) {
        e.spent += MAX_RUN;
        e.startedAt = null;
        changed = true;
      }
    }
  }
  if (changed) save();
}

/* ---------- what's on now ---------- */

function nowSlice(list, nowMin) {
  const sorted = list.slice().sort((a, b) => a.min - b.min);
  let current = null, prev = null, next = null;

  for (const t of sorted) {
    const end = t.min + t.dur;
    if (t.min <= nowMin && nowMin < end) {
      // a short task nested in a long one is the one you're actually on
      if (!current || t.min > current.min) current = t;
    } else if (end <= nowMin) {
      prev = t;
    } else if (t.min > nowMin && !next) {
      next = t;
    }
  }
  // the block before the current one, not the current one itself
  if (current) {
    prev = sorted.filter(t => t !== current && t.min + t.dur <= nowMin).pop() || null;
    next = sorted.find(t => t !== current && t.min >= current.min + current.dur) || null;
  }
  return { current: current, prev: prev, next: next };
}

/* ---------- unplanned time ---------- */

/* merged busy intervals, clamped to the visible day */
function busyIntervals(list, startMin, endMin) {
  const iv = list
    .map(t => [Math.max(t.min, startMin), Math.min(t.min + t.dur, endMin)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  const out = [];
  for (const [s, e] of iv) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/* gaps of at least `minGap` minutes; for today only the ones still ahead of you */
function freeGaps(list, startMin, endMin, fromMin, minGap) {
  const floor = Math.max(startMin, fromMin == null ? startMin : fromMin);
  const gaps = [];
  let cursor = floor;

  for (const [s, e] of busyIntervals(list, startMin, endMin)) {
    if (e <= floor) continue;
    if (s > cursor) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < endMin) gaps.push([cursor, endMin]);

  return gaps
    .map(([s, e]) => ({ s: s, e: e, mins: e - s }))
    .filter(g => g.mins >= (minGap || 15));
}

/* ---------- stats ---------- */

function rangeDates(anchor, span) {
  if (span === 'day') return [new Date(anchor)];
  const d = new Date(anchor);
  const dow = (d.getDay() + 6) % 7;              // Monday = 0
  const monday = addDays(d, -dow);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/* planned vs actually-tracked minutes, grouped by category */
function budget(anchor, span) {
  const rows = new Map();
  let planned = 0, actual = 0;

  for (const date of rangeDates(anchor, span)) {
    const k = keyOf(date);
    for (const t of tasksFor(date)) {
      const cat = styleOf(t).cat;
      const row = rows.get(cat.id) || { cat: cat, planned: 0, actual: 0, count: 0, done: 0 };
      row.planned += t.dur;
      row.actual += elapsed(t.id, k) / 60;
      row.count++;
      if (isDone(t.id, date)) row.done++;
      rows.set(cat.id, row);
      planned += t.dur;
      actual += elapsed(t.id, k) / 60;
    }
  }
  return {
    rows: [...rows.values()].sort((a, b) => b.planned - a.planned),
    planned: planned,
    actual: actual
  };
}

/* does the repeat pattern land on this date? (ignores per-day skips) */
function matchesPattern(task, date) {
  if (task.repeat === 'once') return task.date === keyOf(date);
  if (task.from && keyOf(date) < task.from) return false;
  const dow = date.getDay();
  if (task.repeat === 'daily') return true;
  if (task.repeat === 'weekdays') return dow >= 1 && dow <= 5;
  if (task.repeat === 'custom') return (task.days || []).includes(dow);
  return false;
}

/* consecutive completed occurrences, counting back from the latest one due.
   Today doesn't break a streak until the day is over. */
function streakOf(task) {
  if (task.repeat === 'once') return 0;
  const today = new Date();
  let streak = 0;
  let checked = 0;

  for (let i = 0; i < 400 && checked < 200; i++) {
    const d = addDays(today, -i);
    if (!matchesPattern(task, d)) continue;
    checked++;
    const skipped = (db.skip[keyOf(d)] || {})[task.id];
    if (skipped) continue;                       // a deliberate skip is neutral
    if (isDone(task.id, d)) { streak++; continue; }
    if (i === 0) continue;                       // today is still in play
    break;
  }
  return streak;
}

function allStreaks() {
  return db.tasks
    .filter(t => t.repeat !== 'once')
    .map(t => ({ task: t, streak: streakOf(t), style: styleOf(t) }))
    .filter(s => s.streak > 0)
    .sort((a, b) => b.streak - a.streak);
}

/* ---------- calendar export ---------- */

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const parseKey = k => {
  const p = k.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
};

const icsEscape = s => String(s)
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

function icsStamp(date, min) {
  const d = new Date(date);
  d.setHours(0, min, 0, 0);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
    'T' + p(d.getHours()) + p(d.getMinutes()) + '00';
}

/* RRULE needs DTSTART to fall on a day the rule actually matches */
function firstOccurrence(task) {
  const from = task.from ? parseKey(task.from) : new Date();
  for (let i = 0; i < 370; i++) {
    const d = addDays(from, i);
    if (matchesPattern(task, d)) return d;
  }
  return from;
}

function ruleFor(task) {
  if (task.repeat === 'daily') return 'FREQ=DAILY';
  if (task.repeat === 'weekdays') return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  if (task.repeat === 'custom') {
    const days = (task.days || []).slice().sort().map(d => BYDAY[d]).join(',');
    return days ? 'FREQ=WEEKLY;BYDAY=' + days : null;
  }
  return null;
}

/* Long lines must be folded or strict parsers reject the file. The limit is 75
   *octets*, and splitting mid-emoji would corrupt it, so measure in UTF-8 bytes
   and only ever break between whole code points. */
function fold(line) {
  const bytes = str => new TextEncoder().encode(str).length;
  if (bytes(line) <= 74) return line;

  const chars = Array.from(line);          // whole code points, surrogate pairs intact
  const out = [];
  let cur = '', limit = 74;

  for (const ch of chars) {
    if (bytes(cur + ch) > limit) {
      out.push(cur);
      cur = ' ' + ch;                      // continuation lines start with a space
      limit = 74;
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out.join('\r\n');
}

function buildICS(daysAhead) {
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  const stamp = now.getUTCFullYear() + p(now.getUTCMonth() + 1) + p(now.getUTCDate()) +
    'T' + p(now.getUTCHours()) + p(now.getUTCMinutes()) + p(now.getUTCSeconds()) + 'Z';

  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Day Plan//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Day Plan'
  ];

  const horizon = keyOf(addDays(now, daysAhead || 30));
  const todayK = keyOf(now);
  let count = 0;

  for (const t of db.tasks) {
    let start;
    if (t.repeat === 'once') {
      if (t.date < todayK || t.date > horizon) continue;   // only what's still ahead
      start = parseKey(t.date);
    } else {
      start = firstOccurrence(t);
    }

    const s = styleOf(t);
    const rule = ruleFor(t);

    // a block can run past midnight, so the end may land on the following day
    const endTotal = t.min + t.dur;
    const endDate = addDays(start, Math.floor(endTotal / 1440));

    lines.push('BEGIN:VEVENT');
    lines.push('UID:dayplan-' + t.id + '@eboski.github.io');
    lines.push('DTSTAMP:' + stamp);
    lines.push('DTSTART:' + icsStamp(start, t.min));
    lines.push('DTEND:' + icsStamp(endDate, endTotal % 1440));
    lines.push(fold('SUMMARY:' + icsEscape(s.icon + ' ' + t.title)));
    if (rule) lines.push('RRULE:' + rule);
    lines.push('BEGIN:VALARM');
    lines.push('TRIGGER:-PT5M');
    lines.push('ACTION:DISPLAY');
    lines.push(fold('DESCRIPTION:' + icsEscape(t.title)));
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
    count++;
  }

  lines.push('END:VCALENDAR');
  return { text: lines.join('\r\n'), count: count };
}

/* iOS handles a shared file far better than a download inside a standalone PWA,
   so try the share sheet first and keep the download as the fallback. */
async function shareOrDownload(filename, mime, text) {
  const file = new File([text], filename, { type: mime });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Day Plan' });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return 'downloaded';
}
