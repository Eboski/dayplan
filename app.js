/* Day Plan — offline hour-by-hour planner. All data lives in localStorage. */
'use strict';

const KEY = 'dayplan.v1';

const DEFAULTS = {
  v: 2,
  settings: { start: 6, end: 23, hidePast: false, autoCarry: false },
  tasks: [],   // {id,title,min,dur,repeat,days[],date,from, cat?,icon?,color?}
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
  const out = Object.assign(structuredClone(DEFAULTS), incoming);
  out.settings = Object.assign(structuredClone(DEFAULTS.settings), incoming.settings || {});

  /* v1 gave every task a colour from a fixed six-swatch palette. Those were never
     deliberate choices, so drop them and let the category system take over. */
  if ((incoming.v || 1) < 2) {
    const OLD = ['#4c6ef5', '#2f9e63', '#e8590c', '#c2255c', '#7048e8', '#0c8599'];
    out.tasks.forEach(t => { if (OLD.includes(t.color)) delete t.color; });
    out.v = 2;
  }
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

/* does this phone show 12- or 24-hour time? */
const H12 = /am|pm/i.test(new Date(2000, 0, 1, 13).toLocaleTimeString(undefined, { hour: 'numeric' }));

function hourLabel(h) {
  if (!H12) return pad(h) + ':00';
  const suffix = h < 12 ? 'AM' : 'PM';
  return ((h % 12) || 12) + ' ' + suffix;
}

function fmtTime(min) {
  const d = new Date(2000, 0, 1, Math.floor(min / 60) % 24, min % 60);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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
        cat: t.cat, icon: t.icon, color: t.color,
        repeat: 'once', days: [], date: toK
      });
      moved++;
    }
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

/* ---------- layout ----------
   Blocks are drawn to scale: an hour of the day is one --hour of pixels, so a
   four-hour task is literally four times the height of a one-hour task. Tasks
   that overlap in time are split into side-by-side lanes. */

const HOUR_PX = () =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour')) || 74;

const MIN_PX = 30;   // floor, so a 10-minute task is still tappable

function layout(list, startMin, endMin) {
  const px = HOUR_PX();

  const items = list.map(t => {
    const s = Math.max(t.min, startMin);
    const e = Math.min(t.min + t.dur, endMin);
    return { t: t, s: s, e: Math.max(e, s + 5) };
  }).sort((a, b) => a.s - b.s || b.e - a.e);

  // a cluster is a run of tasks that transitively overlap
  const clusters = [];
  let cur = [], curEnd = -1;
  for (const it of items) {
    if (cur.length && it.s >= curEnd) { clusters.push(cur); cur = []; curEnd = -1; }
    cur.push(it);
    curEnd = Math.max(curEnd, it.e);
  }
  if (cur.length) clusters.push(cur);

  for (const cluster of clusters) {
    const laneEnds = [];
    for (const it of cluster) {
      let lane = laneEnds.findIndex(end => end <= it.s);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.e); }
      else laneEnds[lane] = it.e;
      it.lane = lane;
    }
    /* Two kinds of collision need different treatment. A short task sitting *inside*
       a long one (coffee break during a 4-hour block) shouldn't halve the big block —
       it gets indented and layered on top. Genuinely clashing tasks split the width. */
    const nested = cluster.every(it => it.lane === 0 || cluster.some(o =>
      o !== it && o.s <= it.s && o.e >= it.e && (o.e - o.s) > (it.e - it.s)));

    cluster.forEach(it => { it.lanes = laneEnds.length; it.nested = nested; });
  }

  items.forEach(it => {
    it.top = (it.s - startMin) / 60 * px;
    it.height = Math.max((it.e - it.s) / 60 * px - 4, MIN_PX);
  });

  return items;
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

  renderProgress(list);

  const tl = $('timeline');
  tl.innerHTML = '';

  if (!list.length) {
    const e = document.createElement('div');
    e.className = 'emptyday';
    e.innerHTML = 'Nothing on the clock.<br>Tap <b>+</b> to block out some time.';
    tl.appendChild(e);
    renderCarryBar(tl, list);
    return;
  }

  const px = HOUR_PX();
  const startH = db.settings.start;
  const endH = db.settings.end;
  const startMin = startH * 60;
  const endMin = (endH + 1) * 60;
  const hours = endH - startH + 1;

  const grid = document.createElement('div');
  grid.className = 'grid';
  grid.style.height = (hours * px) + 'px';

  // hour rules, labels and the shading over hours already gone
  for (let i = 0; i <= hours; i++) {
    const h = startH + i;
    const y = i * px;

    if (i < hours) {
      const past = viewKey < todayKey || (viewKey === todayKey && h < now.getHours());
      if (past && db.settings.hidePast) {
        const band = document.createElement('div');
        band.className = 'hband past';
        band.style.top = y + 'px';
        band.style.height = px + 'px';
        grid.appendChild(band);
      }
    }

    const line = document.createElement('div');
    line.className = 'hline' + (h % 6 === 0 ? ' major' : '');
    line.style.top = y + 'px';
    grid.appendChild(line);

    if (i < hours) {
      const label = document.createElement('div');
      label.className = 'hlabel';
      label.style.top = y + 'px';
      label.textContent = hourLabel(h);
      grid.appendChild(label);
    }
  }

  // tapping empty canvas adds a task at that time
  grid.addEventListener('click', ev => {
    if (ev.target !== grid) return;
    const y = ev.offsetY;
    openEdit(null, Math.min(endH, startH + Math.floor(y / px)));
  });

  layout(list, startMin, endMin).forEach(it => grid.appendChild(tileEl(it)));

  if (viewKey === todayKey) {
    const mins = now.getHours() * 60 + now.getMinutes();
    if (mins >= startMin && mins <= endMin) {
      grid.appendChild(nowEl(now, (mins - startMin) / 60 * px));
    }
  }

  tl.appendChild(grid);
  renderCarryBar(tl, list);
}

function renderProgress(list) {
  const doneCount = list.filter(t => isDone(t.id, view)).length;
  const pct = list.length ? Math.round(doneCount / list.length * 100) : 0;
  const fill = $('progressFill');
  fill.style.width = pct + '%';

  // paint the bar with the colours of what's actually been finished
  const colors = list.filter(t => isDone(t.id, view)).map(t => styleOf(t).color);
  const unique = [...new Set(colors)];
  fill.style.backgroundImage = unique.length > 1
    ? 'linear-gradient(90deg,' + unique.join(',') + ')'
    : 'none';
  fill.style.backgroundColor = unique.length === 1 ? unique[0] : 'var(--done)';

  $('progressText').textContent = list.length ? doneCount + '/' + list.length + ' done' : 'Nothing planned';
}

function tileEl(it) {
  const t = it.t;
  const s = styleOf(t);
  const done = isDone(t.id, view);

  const el = document.createElement('div');
  el.className = 'tile' + (done ? ' done' : '') +
    (it.height < 46 ? ' sm' : it.height >= 110 ? ' lg' : '');
  el.style.setProperty('--c', s.color);
  el.style.top = it.top + 'px';
  el.style.height = it.height + 'px';

  if (it.lanes > 1 && it.nested) {
    const indent = 15;                       // % of width surrendered per nesting level
    el.style.left = (it.lane * indent) + '%';
    el.style.width = (100 - it.lane * indent) + '%';
    el.style.zIndex = 2 + it.lane;           // the inner task sits on top
  } else {
    const gap = 1.5;
    const w = 100 / it.lanes;
    el.style.left = 'calc(' + (w * it.lane) + '% + ' + (it.lane ? gap : 0) + 'px)';
    el.style.width = 'calc(' + w + '% - ' + (it.lanes > 1 ? gap * 2 : 0) + 'px)';
  }

  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.textContent = done ? '✓' : s.icon;

  const body = document.createElement('div');
  body.className = 'tbody';

  const title = document.createElement('div');
  title.className = 'ttitle';
  title.textContent = t.title;
  body.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'tmeta';
  meta.appendChild(span(fmtTime(t.min) + ' · ' + fmtDur(t.dur)));
  if (t.repeat !== 'once') meta.appendChild(chip(repeatLabel(t)));
  body.appendChild(meta);

  const edit = document.createElement('button');
  edit.className = 'edit';
  edit.textContent = '⋯';
  edit.setAttribute('aria-label', 'Edit ' + t.title);
  edit.addEventListener('click', ev => { ev.stopPropagation(); openEdit(t.id); });

  el.append(badge, body, edit);
  el.addEventListener('click', () => {
    toggleDone(t.id, view);
    if (navigator.vibrate) navigator.vibrate(8);
    render();
  });
  return el;
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

function nowEl(now, top) {
  const w = document.createElement('div');
  w.className = 'now';
  w.style.top = top + 'px';
  const l = document.createElement('div');
  l.className = 'nowlabel';
  l.textContent = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const line = document.createElement('div');
  line.className = 'nowline';
  w.append(l, line);
  return w;
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
        repeat: 'once',
        days: []
      };

  $('editTitle').textContent = t ? 'Edit task' : 'New task';
  $('fTitle').value = draft.title;
  $('fTime').value = pad(Math.floor(draft.min / 60)) + ':' + pad(draft.min % 60);
  $('fDur').value = String(draft.dur);

  paintRepeat();
  paintIcons();
  paintColors();
  paintPreview();
  restoreActions();
  showSheet('editSheet');
  if (!t) setTimeout(() => $('fTitle').focus(), 320);
}

/* what the draft currently looks like, honouring any overrides */
const draftStyle = () => styleOf({
  title: $('fTitle') ? $('fTitle').value : draft.title,
  cat: draft.cat, icon: draft.icon, color: draft.color
});

function paintPreview() {
  const s = draftStyle();
  const title = ($('fTitle').value || '').trim();
  const parts = ($('fTime').value || '09:00').split(':');
  const min = (+parts[0]) * 60 + (+parts[1]);

  $('pvIcon').textContent = s.icon;
  $('pvTitle').textContent = title || 'New task';
  $('pvMeta').textContent = fmtTime(min) + ' · ' + fmtDur(+$('fDur').value) +
    (draft.cat || draft.icon || draft.color ? '' : ' · ' + s.cat.name);
  $('preview').style.setProperty('--c', s.color);
}

function paintRepeat() {
  Array.from($('fRepeat').children).forEach(b =>
    b.classList.toggle('on', b.dataset.rep === draft.repeat));
  $('dayPickWrap').hidden = draft.repeat !== 'custom';
  Array.from($('fDays').children).forEach(b =>
    b.classList.toggle('on', draft.days.includes(+b.dataset.d)));
}

function paintIcons() {
  const wrap = $('fIcon');
  wrap.innerHTML = '';

  const auto = document.createElement('button');
  auto.type = 'button';
  auto.className = 'auto' + (draft.cat || draft.icon ? '' : ' on');
  auto.textContent = 'AUTO';
  auto.setAttribute('aria-label', 'Choose icon automatically');
  auto.addEventListener('click', () => {
    delete draft.cat; delete draft.icon;
    paintIcons(); paintColors(); paintPreview();
  });
  wrap.appendChild(auto);

  CATEGORIES.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = c.icon;
    b.title = c.name;
    b.setAttribute('aria-label', c.name);
    b.className = draft.cat === c.id ? 'on' : '';
    b.addEventListener('click', () => {
      draft.cat = c.id;
      delete draft.icon;
      paintIcons(); paintColors(); paintPreview();
    });
    wrap.appendChild(b);
  });
}

function paintColors() {
  const wrap = $('fColor');
  wrap.innerHTML = '';

  const auto = document.createElement('button');
  auto.type = 'button';
  auto.className = 'auto' + (draft.color ? '' : ' on');
  auto.textContent = 'AUTO';
  auto.setAttribute('aria-label', 'Choose colour automatically');
  auto.addEventListener('click', () => { delete draft.color; paintColors(); paintPreview(); });
  wrap.appendChild(auto);

  // every category colour is available as a manual override
  [...new Set(CATEGORIES.map(c => c.color))].forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.background = c;
    b.className = draft.color === c ? 'on' : '';
    b.setAttribute('aria-label', 'Colour ' + c);
    b.addEventListener('click', () => { draft.color = c; paintColors(); paintPreview(); });
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
    repeat: draft.repeat,
    days: draft.days.slice()
  };

  const applyStyle = t => {
    if (draft.cat) t.cat = draft.cat; else delete t.cat;
    if (draft.icon) t.icon = draft.icon; else delete t.icon;
    if (draft.color) t.color = draft.color; else delete t.color;
  };

  if (editing) {
    const t = db.tasks.find(x => x.id === editing);
    Object.assign(t, base);
    applyStyle(t);
    if (t.repeat === 'once') { t.date = t.date || keyOf(view); delete t.from; }
    else { t.from = t.from || keyOf(view); delete t.date; }
  } else {
    const t = Object.assign({ id: uid() }, base);
    applyStyle(t);
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

/* the title drives the automatic icon and colour, so preview as it's typed */
$('fTitle').addEventListener('input', () => { paintIcons(); paintColors(); paintPreview(); });
$('fTitle').addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
$('fTime').addEventListener('change', paintPreview);
$('fDur').addEventListener('change', paintPreview);

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
