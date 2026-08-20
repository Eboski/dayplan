/* Day Plan — offline hour-by-hour planner. All data lives in localStorage. */
'use strict';

const KEY = 'dayplan.v1';
const COLORS = ['#4c6ef5', '#2f9e63', '#e8590c', '#c2255c', '#7048e8', '#0c8599'];

const DEFAULTS = {
  v: 1,
  settings: { start: 6, end: 23, hidePast: false, autoCarry: false },
  tasks: [],   // {id,title,min,dur,color,repeat,days[],date,from}
  done: {},    // { 'YYYY-MM-DD': { taskId: true } }
  skip: {}     // { 'YYYY-MM-DD': { taskId: true } }  one-day removals of a repeat
};

let db = load();
let view = new Date();        // the day being shown
let editing = null;           // task id being edited, or null for a new task
let draft = null;             // in-progress form state

/* ---------- storage ---------- */

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    return merge(JSON.parse(raw));
  } catch (e) {
    return structuredClone(DEFAULTS);
  }
}

/* settings is nested, so a plain Object.assign would drop keys added in later versions */
function merge(incoming) {
  const base = structuredClone(DEFAULTS);
  const out = Object.assign(base, incoming);
  out.settings = Object.assign(structuredClone(DEFAULTS.settings), incoming.settings || {});
  return out;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    toast('Could not save — storage is full');
  }
}

/* ---------- dates ---------- */

const pad = n => String(n).padStart(2, '0');
const keyOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function relativeName(d) {
  const k = keyOf(d);
  if (k === keyOf(new Date())) return 'Today';
  if (k === keyOf(addDays(new Date(), 1))) return 'Tomorrow';
  if (k === keyOf(addDays(new Date(), -1))) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long' });
}

function fmtTime(min) {
  const d = new Date(2000, 0, 1, Math.floor(min / 60), min % 60);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/* does this phone show 12- or 24-hour time? */
const H12 = /am|pm/i.test(new Date(2000, 0, 1, 13).toLocaleTimeString(undefined, { hour: 'numeric' }));

function hourLabel(h) {
  if (!H12) return pad(h) + ':00';
  const suffix = h < 12 ? 'AM' : 'PM';
  return ((h % 12) || 12) + ' ' + suffix;
}

function fmtDur(mins) {
  if (mins < 60) return mins + 'm';
  const h = mins / 60;
  return (h % 1 === 0 ? h : h.toFixed(1)) + 'h';
}

/* ---------- occurrences ---------- */

function occursOn(task, date) {
  const k = keyOf(date);
  if (db.skip[k] && db.skip[k][task.id]) return false;
  if (task.repeat === 'once') return task.date === k;
  if (task.from && k < task.from) return false;
  const dow = date.getDay();
  if (task.repeat === 'daily') return true;
  if (task.repeat === 'weekdays') return dow >= 1 && dow <= 5;
  if (task.repeat === 'custom') return (task.days || []).includes(dow);
  return false;
}

const tasksFor = date =>
  db.tasks.filter(t => occursOn(t, date)).sort((a, b) => a.min - b.min);

const isDone = (id, date) => !!(db.done[keyOf(date)] || {})[id];

function toggleDone(id, date) {
  const k = keyOf(date);
  db.done[k] = db.done[k] || {};
  if (db.done[k][id]) delete db.done[k][id];
  else db.done[k][id] = true;
  if (!Object.keys(db.done[k]).length) delete db.done[k];
  save();
}

/* ---------- carrying unfinished work forward ---------- */

const unfinishedOn = date => tasksFor(date).filter(t => !isDone(t.id, date));

/* where should leftovers from `date` land? Tomorrow — unless tomorrow is
   already in the past, in which case today is the only useful destination. */
function carryTarget(date) {
  const next = addDays(date, 1);
  return keyOf(next) < keyOf(new Date()) ? new Date() : next;
}

function carryForward(fromDate, toDate) {
  const toK = keyOf(toDate);
  let moved = 0;

  for (const t of unfinishedOn(fromDate)) {
    if (t.repeat === 'once') {
      t.date = toK;
      moved++;
    } else if (!occursOn(t, toDate)) {
      // a repeat that won't come round again on the target day gets a one-off copy
      db.tasks.push({
        id: uid(), title: t.title, min: t.min, dur: t.dur,
        color: t.color, repeat: 'once', days: [], date: toK
      });
      moved++;
    }
    // a repeat that already lands on the target day needs nothing — it'll be there
    if (db.done[toK]) delete db.done[toK][t.id];
  }

  if (moved) save();
  return moved;
}

/* opt-in: on launch, sweep unfinished one-offs from the last fortnight onto today */
function autoCarry() {
  if (!db.settings.autoCarry) return;
  const todayK = keyOf(new Date());
  const floor = keyOf(addDays(new Date(), -14));
  let moved = 0;
  for (const t of db.tasks) {
    if (t.repeat !== 'once') continue;
    if (!(t.date >= floor && t.date < todayK)) continue;
    if ((db.done[t.date] || {})[t.id]) continue;
    if ((db.skip[t.date] || {})[t.id]) continue;
    t.date = todayK;
    moved++;
  }
  if (moved) { save(); toast(moved + (moved === 1 ? ' task' : ' tasks') + ' carried over to today'); }
}

/* ---------- render ---------- */

const $ = id => document.getElementById(id);

function render() {
  const list = tasksFor(view);
  const todayKey = keyOf(new Date());
  const viewKey = keyOf(view);
  const now = new Date();

  $('dateDay').textContent = relativeName(view);
  $('dateFull').textContent = view.toLocaleDateString(undefined,
    { weekday: 'short', day: 'numeric', month: 'long' });

  const doneCount = list.filter(t => isDone(t.id, view)).length;
  const pct = list.length ? Math.round(doneCount / list.length * 100) : 0;
  $('progressFill').style.width = pct + '%';
  $('progressText').textContent = list.length
    ? doneCount + '/' + list.length + ' done'
    : 'Nothing planned';

  const tl = $('timeline');
  tl.innerHTML = '';

  if (!list.length) {
    const e = document.createElement('div');
    e.className = 'emptyday';
    e.innerHTML = 'Nothing on the clock.<br>Tap <b>+</b> to block out some time.';
    tl.appendChild(e);
    return;
  }

  const start = db.settings.start;
  const end = db.settings.end;
  const buckets = new Map();
  for (let h = start; h <= end; h++) buckets.set(h, []);

  for (const t of list) {
    let h = Math.floor(t.min / 60);
    if (h < start) h = start;
    if (h > end) h = end;
    buckets.get(h).push(t);
  }

  for (const [h, items] of buckets) {
    const past = viewKey < todayKey || (viewKey === todayKey && h < now.getHours());
    if (!items.length && db.settings.hidePast && past) continue;

    const row = document.createElement('div');
    row.className = 'hour' + (items.length ? '' : ' empty') + (past ? ' past' : '');

    const label = document.createElement('div');
    label.className = 'hlabel';
    label.textContent = hourLabel(h);

    const slot = document.createElement('div');
    slot.className = 'hslot';
    items.forEach(t => slot.appendChild(taskEl(t)));
    if (!items.length) slot.addEventListener('click', () => openEdit(null, h));

    row.append(label, slot);
    tl.appendChild(row);

    if (viewKey === todayKey && h === now.getHours()) tl.appendChild(nowEl(now));
  }

  renderCarryBar(tl, list);
}

function renderCarryBar(tl, list) {
  const target = carryTarget(view);
  const where = relativeName(target).toLowerCase();

  // a repeat that already lands on the target day isn't worth offering to move
  const movable = list.filter(t =>
    !isDone(t.id, view) && (t.repeat === 'once' || !occursOn(t, target)));
  if (!movable.length) return;

  const bar = document.createElement('div');
  bar.className = 'carrybar';

  const btn = document.createElement('button');
  btn.className = 'carrybtn';
  btn.textContent = 'Move ' + movable.length + ' unfinished to ' + where;
  btn.addEventListener('click', () => {
    const n = carryForward(view, target);
    render();
    toast('Moved ' + n + ' to ' + where);
  });

  bar.appendChild(btn);
  tl.appendChild(bar);
}

const span = txt => { const s = document.createElement('span'); s.textContent = txt; return s; };
const chip = txt => { const s = document.createElement('span'); s.className = 'chip'; s.textContent = txt; return s; };

function repeatLabel(t) {
  if (t.repeat === 'daily') return 'DAILY';
  if (t.repeat === 'weekdays') return 'WEEKDAYS';
  if (t.repeat === 'custom') {
    const names = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    return (t.days || []).slice().sort().map(d => names[d]).join(' ');
  }
  return '';
}

function taskEl(t) {
  const done = isDone(t.id, view);
  const el = document.createElement('div');
  el.className = 'task' + (done ? ' done' : '');
  el.style.setProperty('--tc', t.color || COLORS[0]);

  const tick = document.createElement('div');
  tick.className = 'tick';
  tick.textContent = '✓';

  const body = document.createElement('div');
  body.className = 'tbody';

  const title = document.createElement('div');
  title.className = 'ttitle';
  title.textContent = t.title;

  const meta = document.createElement('div');
  meta.className = 'tmeta';
  meta.append(span(fmtTime(t.min) + ' · ' + fmtDur(t.dur)));
  if (t.repeat !== 'once') meta.append(chip(repeatLabel(t)));

  body.append(title, meta);

  const edit = document.createElement('button');
  edit.className = 'edit';
  edit.textContent = '⋯';
  edit.setAttribute('aria-label', 'Edit ' + t.title);
  edit.addEventListener('click', ev => { ev.stopPropagation(); openEdit(t.id); });

  el.append(tick, body, edit);
  el.addEventListener('click', () => {
    toggleDone(t.id, view);
    if (navigator.vibrate) navigator.vibrate(8);
    render();
  });
  return el;
}

function nowEl(now) {
  const w = document.createElement('div');
  w.className = 'now';
  const l = document.createElement('div');
  l.className = 'nowlabel';
  l.textContent = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const line = document.createElement('div');
  line.className = 'nowline';
  w.append(l, line);
  return w;
}

/* ---------- edit sheet ---------- */

function openEdit(id, presetHour) {
  editing = id;
  const t = id ? db.tasks.find(x => x.id === id) : null;
  const fallbackHour = Math.min(new Date().getHours() + 1, db.settings.end);

  draft = t
    ? Object.assign({}, t, { days: (t.days || []).slice() })
    : {
        title: '',
        min: (presetHour != null ? presetHour : fallbackHour) * 60,
        dur: 60,
        color: COLORS[0],
        repeat: 'once',
        days: []
      };

  $('editTitle').textContent = t ? 'Edit task' : 'New task';
  $('fTitle').value = draft.title;
  $('fTime').value = pad(Math.floor(draft.min / 60)) + ':' + pad(draft.min % 60);
  $('fDur').value = String(draft.dur);

  paintRepeat();
  paintColors();
  restoreActions();
  showSheet('editSheet');
  if (!t) setTimeout(() => $('fTitle').focus(), 320);
}

function paintRepeat() {
  Array.from($('fRepeat').children).forEach(b =>
    b.classList.toggle('on', b.dataset.rep === draft.repeat));
  $('dayPickWrap').hidden = draft.repeat !== 'custom';
  Array.from($('fDays').children).forEach(b =>
    b.classList.toggle('on', draft.days.includes(+b.dataset.d)));
}

function paintColors() {
  const wrap = $('fColor');
  wrap.innerHTML = '';
  COLORS.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.background = c;
    b.className = draft.color === c ? 'on' : '';
    b.setAttribute('aria-label', 'Colour ' + c);
    b.addEventListener('click', () => { draft.color = c; paintColors(); });
    wrap.appendChild(b);
  });
}

function commit() {
  const title = $('fTitle').value.trim();
  if (!title) { toast('Give it a name first'); $('fTitle').focus(); return; }
  if (draft.repeat === 'custom' && !draft.days.length) { toast('Pick at least one day'); return; }

  const parts = ($('fTime').value || '09:00').split(':');
  const base = {
    title: title,
    min: (+parts[0]) * 60 + (+parts[1]),
    dur: +$('fDur').value,
    color: draft.color,
    repeat: draft.repeat,
    days: draft.days.slice()
  };

  if (editing) {
    const t = db.tasks.find(x => x.id === editing);
    Object.assign(t, base);
    if (t.repeat === 'once') { t.date = t.date || keyOf(view); delete t.from; }
    else { t.from = t.from || keyOf(view); delete t.date; }
  } else {
    const t = Object.assign({ id: uid() }, base);
    if (t.repeat === 'once') t.date = keyOf(view);
    else t.from = keyOf(view);
    db.tasks.push(t);
  }

  save();
  closeSheets();
  render();
}

function uid() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* delete flow — repeating tasks get a two-way choice */

function mkBtn(label, cls, fn) {
  const b = document.createElement('button');
  b.className = 'btn ' + cls;
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

function restoreActions() {
  const bar = document.querySelector('#editSheet .sheetactions');
  bar.innerHTML = '';
  if (editing) {
    const del = mkBtn('Delete', 'ghost', askDelete);
    del.style.color = 'var(--danger)';
    bar.appendChild(del);
  }
  bar.append(mkBtn('Cancel', 'ghost', closeSheets), mkBtn('Save', 'primary', commit));
}

function askDelete() {
  const t = db.tasks.find(x => x.id === editing);
  if (!t) return;
  if (t.repeat === 'once') { removeTask(t.id); return; }

  const bar = document.querySelector('#editSheet .sheetactions');
  bar.innerHTML = '';
  const q = document.createElement('div');
  q.style.cssText = 'flex:1;display:flex;gap:10px;flex-direction:column';
  const cap = document.createElement('div');
  cap.style.cssText = 'font-size:13px;color:var(--muted);text-align:center';
  cap.textContent = 'Remove this repeating task from…';
  const row = document.createElement('div');
  row.className = 'row';
  row.append(
    mkBtn('Just today', 'ghost', () => skipToday(t.id)),
    mkBtn('All days', 'ghost', () => removeTask(t.id)),
    mkBtn('Cancel', 'ghost', restoreActions)
  );
  row.children[1].style.color = 'var(--danger)';
  q.append(cap, row);
  bar.appendChild(q);
}

function removeTask(id) {
  db.tasks = db.tasks.filter(x => x.id !== id);
  Object.keys(db.done).forEach(k => { delete db.done[k][id]; });
  Object.keys(db.skip).forEach(k => { delete db.skip[k][id]; });
  save(); closeSheets(); render(); toast('Deleted');
}

function skipToday(id) {
  const k = keyOf(view);
  db.skip[k] = db.skip[k] || {};
  db.skip[k][id] = true;
  save(); closeSheets(); render(); toast('Skipped for this day');
}

/* ---------- sheets ---------- */

function showSheet(id) {
  $('scrim').hidden = false;
  $(id).hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeSheets() {
  $('scrim').hidden = true;
  $('editSheet').hidden = true;
  $('settingsSheet').hidden = true;
  document.body.style.overflow = '';
  editing = null;
}

/* ---------- settings ---------- */

function openSettings() {
  $('sStart').value = pad(db.settings.start) + ':00';
  $('sEnd').value = pad(db.settings.end) + ':00';
  $('sHidePast').checked = !!db.settings.hidePast;
  $('sAutoCarry').checked = !!db.settings.autoCarry;
  showSheet('settingsSheet');
}

function applySettings() {
  const s = +($('sStart').value || '06:00').split(':')[0];
  const e = +($('sEnd').value || '23:00').split(':')[0];
  db.settings.start = Math.min(s, e);
  db.settings.end = Math.max(s, e);
  db.settings.hidePast = $('sHidePast').checked;
  db.settings.autoCarry = $('sAutoCarry').checked;
  save(); render();
}

function exportData() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'dayplan-backup-' + keyOf(new Date()) + '.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Backup saved');
}

function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const incoming = JSON.parse(r.result);
      if (!incoming || !Array.isArray(incoming.tasks)) throw new Error('bad file');
      db = merge(incoming);
      save(); closeSheets(); render(); toast('Data restored');
    } catch (e) {
      toast('That file did not look right');
    }
  };
  r.readAsText(file);
}

/* ---------- toast ---------- */

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ---------- wiring ---------- */

$('prevDay').addEventListener('click', () => { view = addDays(view, -1); render(); });
$('nextDay').addEventListener('click', () => { view = addDays(view, 1); render(); });
$('dateBtn').addEventListener('click', () => { view = new Date(); render(); scrollToNow(); });
$('addBtn').addEventListener('click', () => openEdit(null));
$('menuBtn').addEventListener('click', openSettings);
$('scrim').addEventListener('click', closeSheets);
$('cancelBtn').addEventListener('click', closeSheets);
$('saveBtn').addEventListener('click', commit);
$('deleteBtn').addEventListener('click', askDelete);
$('settingsClose').addEventListener('click', () => { applySettings(); closeSheets(); });

['sStart', 'sEnd', 'sHidePast', 'sAutoCarry'].forEach(id =>
  $(id).addEventListener('change', applySettings));

$('fRepeat').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  draft.repeat = b.dataset.rep;
  paintRepeat();
});

$('fDays').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = +b.dataset.d;
  const i = draft.days.indexOf(d);
  if (i < 0) draft.days.push(d); else draft.days.splice(i, 1);
  paintRepeat();
});

$('fTitle').addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });

$('exportBtn').addEventListener('click', exportData);
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', e => {
  if (e.target.files[0]) importData(e.target.files[0]);
  e.target.value = '';
});
$('wipeBtn').addEventListener('click', () => {
  if (!confirm('Erase every task and all history? This cannot be undone.')) return;
  db = structuredClone(DEFAULTS);
  save(); closeSheets(); render(); toast('Everything erased');
});

/* swipe between days */
let sx = 0, sy = 0, tracking = false;
document.addEventListener('touchstart', e => {
  if (!$('scrim').hidden) { tracking = false; return; }
  sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
}, { passive: true });

document.addEventListener('touchend', e => {
  if (!tracking) return;
  tracking = false;
  const dx = e.changedTouches[0].clientX - sx;
  const dy = e.changedTouches[0].clientY - sy;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) {
    view = addDays(view, dx < 0 ? 1 : -1);
    render();
  }
}, { passive: true });

function scrollToNow() {
  const n = document.querySelector('.now');
  if (n) n.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* the day can roll over while the app sits in the background */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && $('scrim').hidden) render();
});
setInterval(() => { if ($('scrim').hidden) render(); }, 60000);

autoCarry();
render();
setTimeout(scrollToNow, 300);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
