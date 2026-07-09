/* ============================================================
   disbit — логика приложения (v0.3)
   Данные: localStorage; если открыто через бэкенд (http) —
   дополнительно синхронизируются с API (best-effort).
   Ставки (деньги/блокировка) — СИМУЛЯЦИЯ, ничего реального не происходит.
   ============================================================ */

const STORAGE_KEY  = 'disbit_habits_v1';
const LEDGER_KEY   = 'disbit_ledger_v1';
const SETTLED_KEY  = 'disbit_settled_v1';
const PROFILE_KEY  = 'disbit_profile_v1';
const SETTINGS_KEY = 'disbit_settings_v1';

// если страница открыта с сервера — работаем и с API
const API = location.protocol.startsWith('http') ? '/api' : null;

const ICONS  = ['📚','💧','🏃','🧘','🦷','💪','🥗','😴','✍️','🎯','🧹','🎸'];
const COLORS = ['#F59E0B','#34D399','#38BDF8','#F472B6','#A78BFA','#F87171','#FBBF24','#3B82F6'];
const DAY_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const SCREENS = ['today','calendar','stats','profile'];

const HEATMAP_WEEKS = 16;

let habits   = load();
let ledger   = loadLedger();
let profile  = loadJson(PROFILE_KEY, { name: '', color: COLORS[0], createdAt: null });
let settings = loadJson(SETTINGS_KEY, { showOffday: true });
let editingId = null;      // id привычки в режиме редактирования (null = создаём)
let hmFilter  = 'all';     // фильтр heatmap
let calCursor = null;      // {y, m} — отображаемый месяц календаря
let daySheetKey = null;    // открытый день в шторке дня

/* ---------- SVG-ИКОНКИ ---------- */
function icon(id, cls = 'ic') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
}

/* ---------- ХРАНИЛИЩЕ ---------- */
function loadJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && typeof v === 'object' ? { ...fallback, ...v } : fallback;
  } catch {
    return fallback;
  }
}
function saveJson(key, v) {
  localStorage.setItem(key, JSON.stringify(v));
}
function load() {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    arr.forEach(migrate);
    return arr;
  } catch {
    return [];
  }
}
// миграция старых привычек на новую модель
function migrate(h) {
  if (!Array.isArray(h.schedule) || !h.schedule.length) h.schedule = [0,1,2,3,4,5,6];
  if (!h.createdAt) h.createdAt = dateKey();
  h.history = h.history || {};
  h.counts  = h.counts  || {};
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(habits)); }
function loadLedger() {
  try { return JSON.parse(localStorage.getItem(LEDGER_KEY)) || []; }
  catch { return []; }
}
function saveLedger() { localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger)); }

/* ---------- API (best-effort синхронизация) ---------- */
function apiCall(method, path, body) {
  if (!API) return Promise.resolve(null);
  return fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  }).then(r => (r.ok ? r.json().catch(() => null) : null))
    .catch(() => null);
}
async function apiBootstrap() {
  if (!API) return;
  const remote = await apiCall('GET', '/habits');
  if (Array.isArray(remote) && remote.length) {
    habits = remote;
    habits.forEach(migrate);
    save();
  } else if (Array.isArray(remote) && habits.length) {
    habits.forEach(h => apiCall('POST', '/habits', h));
  }
  const remoteLedger = await apiCall('GET', '/charges');
  if (Array.isArray(remoteLedger) && remoteLedger.length) {
    ledger = remoteLedger;
    saveLedger();
  }
  render();
}

/* ---------- ДАТЫ ---------- */
function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function dayIdx(d) { return (d.getDay() + 6) % 7; }   // 0=Пн … 6=Вс
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
const TODAY = dateKey();

/* ---------- ЛОГИКА ПРИВЫЧЕК ---------- */
function isScheduledOn(h, d) { return h.schedule.includes(dayIdx(d)); }
function isScheduledToday(h) { return isScheduledOn(h, new Date()); }

function doneOn(h, key) {
  if (h.goal.type === 'count') return (h.counts?.[key] || 0) >= h.goal.target;
  return !!h.history?.[key];
}
function isDoneToday(h) { return doneOn(h, TODAY); }

// текущий стрик: незапланированные дни серию не рвут
function computeStreak(h) {
  let streak = 0;
  let d = new Date();
  if (isScheduledOn(h, d) && !doneOn(h, dateKey(d))) d = addDays(d, -1);

  for (let i = 0; i < 3660; i++) {
    const key = dateKey(d);
    if (key < h.createdAt) break;
    if (isScheduledOn(h, d)) {
      if (doneOn(h, key)) streak++;
      else break;
    }
    d = addDays(d, -1);
  }
  return streak;
}

function computeBestStreak(h) {
  let best = 0, cur = 0;
  let d = keyToDate(h.createdAt);
  const end = new Date();
  for (let i = 0; i < 3660 && d <= end; i++) {
    if (isScheduledOn(h, d)) {
      if (doneOn(h, dateKey(d))) {
        cur++;
        if (cur > best) best = cur;
      } else if (dateKey(d) !== TODAY) {
        cur = 0;
      }
    }
    d = addDays(d, 1);
  }
  return best;
}

// установить отметку за произвольный день (сегодня или задним числом)
function setDayMark(h, key, { done, count }) {
  if (h.goal.type === 'count') {
    h.counts[key] = Math.max(0, Math.min(999, count ?? 0));
    h.history[key] = h.counts[key] >= h.goal.target;
  } else {
    h.history[key] = !!done;
  }
  save();
  apiCall('PUT', `/habits/${h.id}/day/${key}`, {
    done: doneOn(h, key),
    count: h.counts[key] || 0
  });
}

// нажатие на кнопку отметки на экране «Сегодня»
function toggleHabit(id) {
  const h = habits.find(x => x.id === id);
  if (!h) return;
  if (h.goal.type === 'count') {
    const cur = h.counts[TODAY] || 0;
    setDayMark(h, TODAY, { count: cur >= h.goal.target ? 0 : cur + 1 });
  } else {
    setDayMark(h, TODAY, { done: !h.history[TODAY] });
  }
  render();
}

function deleteHabit(id) {
  if (!confirm('Удалить привычку?')) return;
  habits = habits.filter(x => x.id !== id);
  save();
  apiCall('DELETE', `/habits/${id}`);
  render();
}

/* ---------- АВТОИТОГ ПРОШЕДШИХ ДНЕЙ ---------- */
function settlePastDays() {
  const yesterday = dateKey(addDays(new Date(), -1));
  const last = localStorage.getItem(SETTLED_KEY);

  if (!last) {
    localStorage.setItem(SETTLED_KEY, yesterday);
    return [];
  }
  if (last >= yesterday) return [];

  const fresh = [];
  let d = addDays(keyToDate(last), 1);
  const end = keyToDate(yesterday);

  for (let i = 0; i < 366 && d <= end; i++, d = addDays(d, 1)) {
    const key = dateKey(d);
    habits.forEach(h => {
      if (h.createdAt > key) return;
      if (!isScheduledOn(h, d)) return;
      if (doneOn(h, key)) return;
      fresh.push({
        day: key,
        habitId: h.id,
        name: h.name,
        icon: h.icon,
        mode: h.stake.mode,
        amount: h.stake.mode === 'money' ? Number(h.stake.amount || 0) : 0,
        recipient: h.stake.recipient || null,
        apps: h.stake.mode === 'lock' ? (h.stake.apps || []) : []
      });
    });
  }

  localStorage.setItem(SETTLED_KEY, yesterday);
  if (fresh.length) {
    ledger.push(...fresh);
    saveLedger();
    apiCall('POST', '/charges', fresh);
  }
  return fresh;
}

function showSettleModal(entries) {
  const body = document.getElementById('settle-body');
  const money = entries.reduce((s, e) => s + e.amount, 0);
  const apps = new Set();
  entries.forEach(e => e.apps.forEach(a => apps.add(a)));

  let html = `<p style="color:var(--text-2);font-size:14px;margin-bottom:14px">
    Пропущено привычек: <b style="color:var(--text)">${entries.length}</b></p>`;
  if (money) {
    html += `<div class="summary-total"><div class="amount">−${money}₽</div>
      <div class="label">списалось бы за пропуски</div></div>`;
  }
  if (apps.size) {
    html += `<div class="summary-row"><span class="big lock">${icon('i-lock')}</span>
      <div><div>Заблокировались бы</div><b>${[...apps].map(escapeHtml).join(', ')}</b></div></div>`;
  }
  html += entries.slice(-8).reverse().map(e => `
    <div class="ledger-row">
      <span class="ledger-icon">${e.icon}</span>
      <div class="ledger-main">
        <div class="ledger-name">${escapeHtml(e.name)}</div>
        <div class="ledger-day">${formatDay(e.day)}</div>
      </div>
      <span class="ledger-amount">${e.mode === 'money' ? '−' + e.amount + '₽' : icon('i-lock')}</span>
    </div>`).join('');

  body.innerHTML = html;
  openSheet('settle-overlay');
}

/* ---------- ОБЩИЙ РЕНДЕР ---------- */
function render() {
  renderWeek();
  renderHabits();
  renderProgress();
  renderCalendar();
  renderStats();
  renderProfile();
}

/* ---------- ЭКРАН «СЕГОДНЯ» ---------- */
function renderWeek() {
  const now = new Date();
  const monday = addDays(now, -dayIdx(now));

  const box = document.getElementById('week-strip');
  box.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const key = dateKey(d);
    const isToday = key === TODAY;
    const isFuture = key > TODAY;

    let dotCls = '';
    if (!isFuture) {
      const sched = habits.filter(h => h.createdAt <= key && isScheduledOn(h, d));
      if (sched.length) {
        const done = sched.filter(h => doneOn(h, key)).length;
        dotCls = done === sched.length ? 'full' : (done > 0 ? 'half' : (isToday ? '' : 'miss'));
      }
    }

    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'day' + (isToday ? ' today' : '');
    el.disabled = isFuture;
    el.setAttribute('aria-label', formatDay(key));
    el.innerHTML = `<span class="dname">${DAY_NAMES[i]}</span>
      <span class="dnum">${d.getDate()}</span>
      <i class="ddot ${dotCls}"></i>`;
    el.addEventListener('click', () => openDaySheet(key));
    box.appendChild(el);
  }
}

function habitCard(h, off) {
  const done = isDoneToday(h);
  const streak = computeStreak(h);

  let checkContent = icon('i-check');
  if (!done && h.goal.type === 'count') checkContent = String(h.counts?.[TODAY] || 0);
  else if (!done) checkContent = '';

  const goalText = h.goal.type === 'count'
    ? `${h.counts?.[TODAY] || 0}/${h.goal.target} ${h.goal.unit || ''}`.trim()
    : '';

  const stake = h.stake.mode === 'money'
    ? `<span class="stake-badge money">${icon('i-coins')}${h.stake.amount}₽</span>`
    : `<span class="stake-badge lock">${icon('i-lock')}${(h.stake.apps || []).length || ''} прил.</span>`;

  const schedText = h.schedule.length === 7
    ? 'каждый день'
    : h.schedule.map(i => DAY_NAMES[i]).join(' · ');

  const card = document.createElement('div');
  card.className = 'habit' + (done ? ' done' : '') + (off ? ' off' : '');
  card.innerHTML = `
    <div class="habit-icon" style="background:${h.color}22">${h.icon}</div>
    <div class="habit-main" data-edit="${h.id}" role="button" tabindex="0" aria-label="Редактировать: ${escapeHtml(h.name)}">
      <div class="habit-name">${escapeHtml(h.name)}</div>
      <div class="habit-meta">
        <span class="streak ${streak ? '' : 'zero'}">${icon('i-flame')}${streak}</span>
        ${goalText && !off ? `<span class="goal-text">${goalText}</span>` : ''}
        ${off ? `<span class="goal-text">${schedText}</span>` : ''}
        ${stake}
      </div>
    </div>
    <button class="habit-del" data-del="${h.id}" aria-label="Удалить привычку">${icon('i-x')}</button>
    ${off ? '' : `<button class="habit-check" data-check="${h.id}" aria-label="Отметить: ${escapeHtml(h.name)}">${checkContent}</button>`}
  `;
  return card;
}

function renderHabits() {
  const list = document.getElementById('habit-list');
  const offList = document.getElementById('offday-list');
  const offBlock = document.getElementById('offday-block');
  const empty = document.getElementById('empty-state');
  list.innerHTML = '';
  offList.innerHTML = '';

  empty.hidden = habits.length > 0;
  document.getElementById('btn-day-summary').hidden = habits.length === 0;

  const todays = habits.filter(isScheduledToday);
  const off = habits.filter(h => !isScheduledToday(h));

  todays.forEach(h => list.appendChild(habitCard(h, false)));
  if (settings.showOffday) off.forEach(h => offList.appendChild(habitCard(h, true)));
  offBlock.hidden = !settings.showOffday || off.length === 0;

  document.querySelectorAll('#screen-today [data-check]').forEach(b =>
    b.addEventListener('click', () => toggleHabit(b.dataset.check)));
  document.querySelectorAll('#screen-today [data-del]').forEach(b =>
    b.addEventListener('click', () => deleteHabit(b.dataset.del)));
  document.querySelectorAll('#screen-today [data-edit]').forEach(b => {
    b.addEventListener('click', () => openEditSheet(b.dataset.edit));
    b.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditSheet(b.dataset.edit); }
    });
  });
}

function renderProgress() {
  const todays = habits.filter(isScheduledToday);
  const total = todays.length;
  const done = todays.filter(isDoneToday).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  document.getElementById('done-count').textContent = done;
  document.getElementById('total-count').textContent = total;
  document.getElementById('ring-label').textContent = pct + '%';

  const C = 327;   // 2π·52
  document.getElementById('ring-fg').style.strokeDashoffset = C - (C * pct) / 100;

  const notDone = todays.filter(h => !isDoneToday(h));
  const money = notDone
    .filter(h => h.stake.mode === 'money')
    .reduce((s, h) => s + Number(h.stake.amount || 0), 0);
  const locks = notDone.filter(h => h.stake.mode === 'lock').length;

  const parts = [];
  if (money) parts.push(`${money}₽`);
  if (locks) parts.push(`${locks} блокир.`);
  const pill = document.getElementById('at-risk');
  pill.hidden = parts.length === 0;
  document.getElementById('at-risk-text').textContent =
    parts.length ? `Под риском: ${parts.join(' + ')}` : '';
}

/* ---------- ЭКРАН «КАЛЕНДАРЬ» ---------- */

// состояние дня для пула привычек: done | part | fail | off | plain
function dayState(d) {
  const key = dateKey(d);
  const sched = habits.filter(h => h.createdAt <= key && isScheduledOn(h, d));
  if (!sched.length) return 'off';
  const done = sched.filter(h => doneOn(h, key)).length;
  if (done === sched.length) return 'done';
  if (done > 0) return 'part';
  return key < TODAY ? 'fail' : 'plain';
}

function renderCalendar() {
  if (!calCursor) {
    const now = new Date();
    calCursor = { y: now.getFullYear(), m: now.getMonth() };
  }
  const { y, m } = calCursor;
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  // заголовок «июль 2026»
  document.getElementById('cal-title').textContent =
    first.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '');

  const now = new Date();
  const isCurrentMonth = y === now.getFullYear() && m === now.getMonth();
  document.getElementById('cal-today-btn').hidden = isCurrentMonth;

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  // пустые ячейки до первого дня месяца
  for (let i = 0; i < dayIdx(first); i++) {
    const ghost = document.createElement('div');
    ghost.className = 'cal-cell ghost';
    grid.appendChild(ghost);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(y, m, day);
    const key = dateKey(d);
    const isFuture = key > TODAY;
    const state = isFuture ? 'future' : dayState(d);

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = `cal-cell ${state}` + (key === TODAY ? ' today' : '');
    cell.disabled = isFuture;
    cell.setAttribute('aria-label', formatDay(key));
    cell.innerHTML = `<span class="cnum">${day}</span>`;
    if (!isFuture) cell.addEventListener('click', () => openDaySheet(key));
    grid.appendChild(cell);
  }

  renderCalMonthStats(y, m, daysInMonth);
}

function renderCalMonthStats(y, m, daysInMonth) {
  let doneCount = 0, failCount = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(y, m, day);
    const key = dateKey(d);
    if (key > TODAY) break;
    habits.forEach(h => {
      if (h.createdAt > key || !isScheduledOn(h, d)) return;
      if (doneOn(h, key)) doneCount++;
      else if (key < TODAY) failCount++;
    });
  }
  const prefix = `${y}-${String(m + 1).padStart(2, '0')}-`;
  const lost = ledger
    .filter(e => e.day.startsWith(prefix))
    .reduce((s, e) => s + (e.amount || 0), 0);

  document.getElementById('cal-month-stats').innerHTML = `
    <div class="cal-stats-row">
      <div class="cal-stat good"><b>${doneCount}</b><span>выполнено</span></div>
      <div class="cal-stat bad"><b>${failCount}</b><span>пропусков</span></div>
      <div class="cal-stat gold"><b>${lost}₽</b><span>потеряно</span></div>
    </div>`;
}

function shiftMonth(delta) {
  const d = new Date(calCursor.y, calCursor.m + delta, 1);
  calCursor = { y: d.getFullYear(), m: d.getMonth() };
  renderCalendar();
}

/* ---------- ШТОРКА ДНЯ (ретро-редактирование) ---------- */
function openDaySheet(key) {
  daySheetKey = key;
  document.getElementById('day-title').textContent = formatDay(key);
  renderDaySheet();
  openSheet('day-overlay');
}

function renderDaySheet() {
  const key = daySheetKey;
  const d = keyToDate(key);
  const body = document.getElementById('day-body');
  const scheduled = habits.filter(h => h.createdAt <= key && isScheduledOn(h, d));

  let html = '';

  if (!scheduled.length) {
    html += `<p class="hint" style="text-align:center;padding:16px 0">На этот день ничего не запланировано.</p>`;
  } else {
    html += scheduled.map(h => {
      const done = doneOn(h, key);
      let control;
      if (h.goal.type === 'count') {
        const val = h.counts?.[key] || 0;
        control = `
          <div class="stepper">
            <button data-step="-1" data-h="${h.id}" aria-label="Меньше">${icon('i-minus', 'ic ic-s')}</button>
            <span class="stp-val ${done ? 'ok' : ''}">${val}/${h.goal.target}</span>
            <button data-step="1" data-h="${h.id}" aria-label="Больше">${icon('i-plus', 'ic ic-s')}</button>
          </div>`;
      } else {
        control = `
          <button class="habit-check" style="width:42px;height:42px" data-dtoggle="${h.id}"
            aria-label="Отметить: ${escapeHtml(h.name)}">${done ? icon('i-check') : ''}</button>`;
      }
      return `
        <div class="day-habit-row ${done ? 'done' : ''}">
          <div class="habit-icon" style="background:${h.color}22;width:42px;height:42px;font-size:19px">${h.icon}</div>
          <div class="ledger-main">
            <div class="ledger-name">${escapeHtml(h.name)}</div>
            <div class="ledger-day">${done ? 'выполнено' : 'не выполнено'}</div>
          </div>
          ${control}
        </div>`;
    }).join('');
  }

  // списания этого дня
  const charges = ledger.filter(e => e.day === key);
  if (charges.length) {
    html += `<p class="field-label">Списания за этот день</p>`;
    html += charges.map(e => `
      <div class="ledger-row">
        <span class="ledger-icon">${e.icon || ''}</span>
        <div class="ledger-main"><div class="ledger-name">${escapeHtml(e.name || '')}</div></div>
        <span class="ledger-amount">${e.mode === 'money'
          ? `−${e.amount}₽` : `${icon('i-lock')} ${(e.apps || []).length}`}</span>
      </div>`).join('');
  }

  if (key < TODAY && scheduled.length) {
    html += `<p class="hint">Отметки задним числом влияют на стрики и календарь.
      Уже зафиксированные списания не отменяются.</p>`;
  }

  body.innerHTML = html;

  // обработчики
  body.querySelectorAll('[data-dtoggle]').forEach(b =>
    b.addEventListener('click', () => {
      const h = habits.find(x => x.id === b.dataset.dtoggle);
      if (!h) return;
      setDayMark(h, key, { done: !h.history[key] });
      renderDaySheet();
      render();
    }));
  body.querySelectorAll('[data-step]').forEach(b =>
    b.addEventListener('click', () => {
      const h = habits.find(x => x.id === b.dataset.h);
      if (!h) return;
      const cur = h.counts?.[key] || 0;
      setDayMark(h, key, { count: cur + Number(b.dataset.step) });
      renderDaySheet();
      render();
    }));
}

/* ---------- ЭКРАН «СТАТИСТИКА» ---------- */
function renderStats() {
  const curStreak = habits.length ? Math.max(...habits.map(computeStreak)) : 0;
  const bestStreak = habits.length ? Math.max(...habits.map(computeBestStreak)) : 0;
  const totalDone = habits.reduce(
    (s, h) => s + Object.keys(h.history).filter(k => doneOn(h, k)).length, 0);
  const lost = ledger.reduce((s, e) => s + (e.amount || 0), 0);

  document.getElementById('st-current-streak').textContent = curStreak;
  document.getElementById('st-best-streak').textContent = bestStreak;
  document.getElementById('st-total-done').textContent = totalDone;
  document.getElementById('st-lost').textContent = lost + '₽';

  renderHmChips();
  renderHeatmap();
  renderStreakList();
  renderLedger();
}

function renderHmChips() {
  const box = document.getElementById('hm-chips');
  box.innerHTML = '';
  const mk = (id, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (hmFilter === id ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      hmFilter = id;
      renderHmChips();
      renderHeatmap();
    });
    box.appendChild(b);
  };
  mk('all', 'Все');
  habits.forEach(h => mk(h.id, `${h.icon} ${h.name.length > 12 ? h.name.slice(0, 12) + '…' : h.name}`));
  if (hmFilter !== 'all' && !habits.find(h => h.id === hmFilter)) hmFilter = 'all';
}

function hmLevel(d) {
  const key = dateKey(d);
  if (key > TODAY) return 'future';

  const pool = hmFilter === 'all' ? habits : habits.filter(h => h.id === hmFilter);
  const sched = pool.filter(h => h.createdAt <= key && isScheduledOn(h, d));
  if (!sched.length) return 'off';

  const done = sched.filter(h => doneOn(h, key)).length;
  const ratio = done / sched.length;

  if (ratio === 0) return key === TODAY ? 'l0' : 'fail';
  if (ratio === 1) return 'l3';
  return ratio >= 0.5 ? 'l2' : 'l1';
}

function renderHeatmap() {
  const box = document.getElementById('heatmap');
  box.innerHTML = '';
  document.getElementById('hm-weeks-label').textContent = `последние ${HEATMAP_WEEKS} недель`;

  const now = new Date();
  const thisMonday = addDays(now, -dayIdx(now));

  for (let w = HEATMAP_WEEKS - 1; w >= 0; w--) {
    const col = document.createElement('div');
    col.className = 'hm-col';
    const monday = addDays(thisMonday, -7 * w);
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i);
      const cell = document.createElement('i');
      cell.className = 'hm-cell ' + hmLevel(d);
      cell.title = formatDay(dateKey(d));
      col.appendChild(cell);
    }
    box.appendChild(col);
  }
}

function renderStreakList() {
  const box = document.getElementById('streak-list');
  if (!habits.length) {
    box.innerHTML = `<p class="hint">Добавь привычки — здесь появятся серии.</p>`;
    return;
  }
  const rows = habits
    .map(h => ({ h, cur: computeStreak(h), best: computeBestStreak(h) }))
    .sort((a, b) => b.cur - a.cur);

  box.innerHTML = rows.map(({ h, cur, best }) => `
    <div class="ledger-row">
      <span class="ledger-icon" style="background:${h.color}22">${h.icon}</span>
      <div class="ledger-main">
        <div class="ledger-name">${escapeHtml(h.name)}</div>
        <div class="ledger-day">лучший: ${best}</div>
      </div>
      <span class="streak-big ${cur ? '' : 'zero'}">${icon('i-flame')}${cur}</span>
    </div>`).join('');
}

function renderLedger() {
  const box = document.getElementById('ledger-list');
  if (!ledger.length) {
    box.innerHTML = `<p class="hint">Пока пусто — ни одного пропуска. Так держать!</p>`;
    return;
  }
  box.innerHTML = ledger.slice(-30).reverse().map(e => `
    <div class="ledger-row">
      <span class="ledger-icon">${e.icon || ''}</span>
      <div class="ledger-main">
        <div class="ledger-name">${escapeHtml(e.name || '')}</div>
        <div class="ledger-day">${formatDay(e.day)}</div>
      </div>
      <span class="ledger-amount">${e.mode === 'money'
        ? `−${e.amount}₽ ${icon(e.recipient === 'charity' ? 'i-heart' : 'i-tool')}`
        : `${icon('i-lock')} ${(e.apps || []).length}`}</span>
    </div>`).join('');
}

/* ---------- ЭКРАН «ПРОФИЛЬ» ---------- */
function renderProfile() {
  const name = profile.name?.trim();
  document.getElementById('profile-name').textContent = name || 'Без имени';
  const av = document.getElementById('profile-avatar');
  av.textContent = name ? name[0] : '?';
  av.style.background = profile.color || COLORS[0];

  const firstDay = habits.length
    ? habits.map(h => h.createdAt).sort()[0]
    : profile.createdAt;
  document.getElementById('profile-since').textContent =
    firstDay ? `в disbit с ${formatDay(firstDay)}` : 'добро пожаловать!';

  const totalDone = habits.reduce(
    (s, h) => s + Object.keys(h.history).filter(k => doneOn(h, k)).length, 0);
  const best = habits.length ? Math.max(...habits.map(computeBestStreak)) : 0;
  const lost = ledger.reduce((s, e) => s + (e.amount || 0), 0);

  document.getElementById('pf-habits').textContent = habits.length;
  document.getElementById('pf-done').textContent = totalDone;
  document.getElementById('pf-best').textContent = best;
  document.getElementById('pf-lost').textContent = lost + '₽';

  document.getElementById('set-offday').checked = !!settings.showOffday;
}

function openProfileSheet() {
  document.getElementById('pf-name-input').value = profile.name || '';
  buildColorPicker('pf-color-picker', profile.color || COLORS[0]);
  openSheet('profile-overlay');
  document.getElementById('pf-name-input').focus();
}

function saveProfile() {
  profile.name = document.getElementById('pf-name-input').value.trim();
  const sel = document.querySelector('#pf-color-picker .selected');
  if (sel) profile.color = sel.dataset.color;
  if (!profile.createdAt) profile.createdAt = TODAY;
  saveJson(PROFILE_KEY, profile);
  closeSheet('profile-overlay');
  renderProfile();
}

/* ---------- ЭКСПОРТ / ИМПОРТ / ОЧИСТКА ---------- */
function exportData() {
  const data = {
    app: 'disbit',
    version: 3,
    exportedAt: new Date().toISOString(),
    habits, ledger, profile, settings,
    settled: localStorage.getItem(SETTLED_KEY)
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `disbit-backup-${TODAY}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.habits)) throw new Error('нет массива habits');
      if (!confirm(`Импортировать ${data.habits.length} привычек? Текущие данные будут заменены.`)) return;

      habits = data.habits;
      habits.forEach(migrate);
      ledger = Array.isArray(data.ledger) ? data.ledger : [];
      if (data.profile && typeof data.profile === 'object') profile = { ...profile, ...data.profile };
      if (data.settings && typeof data.settings === 'object') settings = { ...settings, ...data.settings };
      if (data.settled) localStorage.setItem(SETTLED_KEY, data.settled);

      save(); saveLedger();
      saveJson(PROFILE_KEY, profile);
      saveJson(SETTINGS_KEY, settings);
      render();
      alert('Импорт завершён ✔');
    } catch (e) {
      alert('Не удалось импортировать: ' + e.message);
    }
  };
  reader.readAsText(file);
}

function wipeData() {
  if (!confirm('Стереть ВСЕ данные disbit? Это действие необратимо.')) return;
  if (!confirm('Точно? Привычки, история и журнал списаний будут удалены.')) return;
  [STORAGE_KEY, LEDGER_KEY, SETTLED_KEY, PROFILE_KEY, SETTINGS_KEY]
    .forEach(k => localStorage.removeItem(k));
  location.reload();
}

/* ---------- НАВИГАЦИЯ ПО ЭКРАНАМ (hash-роутинг) ---------- */
function switchScreen(name, updateHash = true) {
  if (!SCREENS.includes(name)) name = 'today';
  document.querySelectorAll('.screen').forEach(s =>
    s.classList.toggle('active', s.id === 'screen-' + name));
  document.querySelectorAll('.nav-item[data-screen]').forEach(b =>
    b.classList.toggle('active', b.dataset.screen === name));
  if (updateHash && location.hash !== '#' + name) {
    history.replaceState(null, '', '#' + name);
  }
  if (name === 'stats') renderStats();
  if (name === 'calendar') renderCalendar();
  if (name === 'profile') renderProfile();
}

/* ---------- ШТОРКИ ---------- */
function openSheet(id) { document.getElementById(id).hidden = false; }
function closeSheet(id) {
  document.getElementById(id).hidden = true;
  if (id === 'add-overlay') editingId = null;
  if (id === 'day-overlay') daySheetKey = null;
}
function anyOpenSheet() {
  return [...document.querySelectorAll('.sheet-overlay')].find(o => !o.hidden);
}

/* ---------- ФОРМА ПРИВЫЧКИ ---------- */
function buildColorPicker(containerId, selectedColor) {
  const cp = document.getElementById(containerId);
  cp.innerHTML = '';
  COLORS.forEach(col => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pick color' + (col === selectedColor ? ' selected' : '');
    b.style.background = col;
    b.dataset.color = col;
    b.setAttribute('aria-label', 'Цвет ' + col);
    b.addEventListener('click', () => selectIn(cp, b));
    cp.appendChild(b);
  });
}

function buildPickers() {
  const ip = document.getElementById('icon-picker');
  ip.innerHTML = '';
  ICONS.forEach((ic, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pick' + (i === 0 ? ' selected' : '');
    b.textContent = ic;
    b.dataset.icon = ic;
    b.addEventListener('click', () => selectIn(ip, b));
    ip.appendChild(b);
  });
  buildColorPicker('color-picker', COLORS[0]);
}
function selectIn(container, btn) {
  container.querySelectorAll('.pick').forEach(p => p.classList.remove('selected'));
  btn.classList.add('selected');
}

function buildDayPicker(selected = [0,1,2,3,4,5,6]) {
  const dp = document.getElementById('day-picker');
  dp.innerHTML = '';
  DAY_NAMES.forEach((n, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dpick' + (selected.includes(i) ? ' selected' : '');
    b.textContent = n;
    b.dataset.day = i;
    b.setAttribute('aria-pressed', selected.includes(i));
    b.addEventListener('click', () => {
      b.classList.toggle('selected');
      b.setAttribute('aria-pressed', b.classList.contains('selected'));
    });
    dp.appendChild(b);
  });
}
function selectedDays() {
  return [...document.querySelectorAll('#day-picker .dpick.selected')]
    .map(b => Number(b.dataset.day));
}

function wireSeg(segId, onChange) {
  const seg = document.getElementById(segId);
  seg.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      seg.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (onChange) onChange(btn);
    });
  });
}
function segValue(segId, attr) {
  return document.querySelector(`#${segId} .seg-btn.active`).dataset[attr];
}

function openAddSheet() {
  editingId = null;
  document.getElementById('add-title').textContent = 'Новая привычка';
  document.getElementById('btn-save').textContent = 'Создать привычку';
  resetAddForm();
  openSheet('add-overlay');
  document.getElementById('f-name').focus();
}

function openEditSheet(id) {
  const h = habits.find(x => x.id === id);
  if (!h) return;
  editingId = id;
  document.getElementById('add-title').textContent = 'Редактировать привычку';
  document.getElementById('btn-save').textContent = 'Сохранить';

  buildPickers();
  setPickSelected('icon-picker', 'icon', h.icon);
  setPickSelected('color-picker', 'color', h.color);
  buildDayPicker(h.schedule);
  document.getElementById('f-name').value = h.name;

  setSegActive('goal-type', 'goal', h.goal.type);
  document.getElementById('count-fields').hidden = h.goal.type !== 'count';
  document.getElementById('f-target').value = h.goal.target || 5;
  document.getElementById('f-unit').value = h.goal.unit || '';

  setSegActive('stake-mode', 'stake', h.stake.mode);
  const isMoney = h.stake.mode === 'money';
  document.getElementById('stake-money').hidden = !isMoney;
  document.getElementById('stake-lock').hidden = isMoney;
  if (isMoney) {
    document.getElementById('f-amount').value = h.stake.amount;
    setSegActive('recipient', 'rec', h.stake.recipient);
  } else {
    document.getElementById('f-apps').value = (h.stake.apps || []).join(', ');
  }

  openSheet('add-overlay');
}

function setPickSelected(containerId, attr, value) {
  document.getElementById(containerId)
    .querySelectorAll('.pick')
    .forEach(p => p.classList.toggle('selected', p.dataset[attr] === value));
}
function setSegActive(segId, attr, value) {
  document.getElementById(segId)
    .querySelectorAll('.seg-btn')
    .forEach(b => b.classList.toggle('active', b.dataset[attr] === value));
}
function resetAddForm() {
  document.getElementById('f-name').value = '';
  document.getElementById('f-target').value = 5;
  document.getElementById('f-unit').value = '';
  document.getElementById('f-amount').value = 100;
  document.getElementById('f-apps').value = '';
  buildPickers();
  buildDayPicker();
  ['goal-type','stake-mode','recipient'].forEach(id => {
    const seg = document.getElementById(id);
    seg.querySelectorAll('.seg-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  });
  document.getElementById('count-fields').hidden = true;
  document.getElementById('stake-money').hidden = false;
  document.getElementById('stake-lock').hidden = true;
}

function submitHabit() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { alert('Введите название привычки'); return; }

  const schedule = selectedDays();
  if (!schedule.length) { alert('Выбери хотя бы один день недели'); return; }

  const goalType = segValue('goal-type', 'goal');
  const stakeMode = segValue('stake-mode', 'stake');

  const data = {
    name,
    icon: document.querySelector('#icon-picker .selected').dataset.icon,
    color: document.querySelector('#color-picker .selected').dataset.color,
    schedule,
    goal: {
      type: goalType,
      target: goalType === 'count' ? Math.max(1, Number(document.getElementById('f-target').value) || 1) : 1,
      unit: goalType === 'count' ? document.getElementById('f-unit').value.trim() : ''
    },
    stake: stakeMode === 'money'
      ? {
          mode: 'money',
          amount: Math.max(0, Number(document.getElementById('f-amount').value) || 0),
          recipient: segValue('recipient', 'rec')
        }
      : {
          mode: 'lock',
          apps: document.getElementById('f-apps').value
            .split(',').map(s => s.trim()).filter(Boolean)
        }
  };

  if (editingId) {
    const h = habits.find(x => x.id === editingId);
    if (h) {
      Object.assign(h, data);
      apiCall('PUT', `/habits/${h.id}`, h);
    }
  } else {
    const h = { id: 'h' + Date.now(), ...data, createdAt: TODAY, counts: {}, history: {} };
    habits.push(h);
    apiCall('POST', '/habits', h);
  }

  save();
  closeSheet('add-overlay');
  render();
}

/* ---------- ИТОГ ДНЯ (СИМУЛЯЦИЯ, вручную) ---------- */
function showDaySummary() {
  const todays = habits.filter(isScheduledToday);
  const notDone = todays.filter(h => !isDoneToday(h));
  const body = document.getElementById('summary-body');

  if (habits.length === 0) {
    body.innerHTML = `<div class="summary-ok">Сначала добавь привычки 🌱</div>`;
  } else if (notDone.length === 0) {
    body.innerHTML = `<div class="summary-ok">Все привычки выполнены!<br/>Ничего бы не списалось. 🎉</div>`;
  } else {
    let charity = 0, creators = 0;
    const apps = new Set();
    notDone.forEach(h => {
      if (h.stake.mode === 'money') {
        if (h.stake.recipient === 'charity') charity += Number(h.stake.amount || 0);
        else creators += Number(h.stake.amount || 0);
      } else {
        (h.stake.apps || []).forEach(a => apps.add(a));
      }
    });
    const total = charity + creators;

    let html = `<p style="color:var(--text-2);font-size:14px;margin-bottom:14px">
      Не выполнено привычек: <b style="color:var(--text)">${notDone.length}</b></p>`;

    if (total > 0) {
      html += `<div class="summary-total"><div class="amount">${total}₽</div>
        <div class="label">спишется, если не выполнить до конца дня</div></div>`;
      if (charity) html += `<div class="summary-row"><span class="big heart">${icon('i-heart')}</span>
        <div><div>Благотворительность</div><b>${charity}₽</b></div></div>`;
      if (creators) html += `<div class="summary-row"><span class="big tool">${icon('i-tool')}</span>
        <div><div>Создателям</div><b>${creators}₽</b></div></div>`;
    }
    if (apps.size) {
      html += `<div class="summary-row"><span class="big lock">${icon('i-lock')}</span>
        <div><div>Заблокируются приложения</div>
        <b>${[...apps].map(escapeHtml).join(', ')}</b></div></div>`;
    }
    body.innerHTML = html;
  }
  openSheet('summary-overlay');
}

/* ---------- УТИЛИТЫ ---------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatDay(key) {
  return keyToDate(key).toLocaleDateString('ru-RU',
    { weekday: 'short', day: 'numeric', month: 'long' });
}

/* ---------- ИНИЦИАЛИЗАЦИЯ ---------- */
function init() {
  document.getElementById('header-date').textContent = formatDay(TODAY);
  if (!profile.createdAt) {
    profile.createdAt = TODAY;
    saveJson(PROFILE_KEY, profile);
  }

  buildPickers();
  buildDayPicker();

  wireSeg('goal-type', btn => {
    document.getElementById('count-fields').hidden = btn.dataset.goal !== 'count';
  });
  wireSeg('stake-mode', btn => {
    const money = btn.dataset.stake === 'money';
    document.getElementById('stake-money').hidden = !money;
    document.getElementById('stake-lock').hidden = money;
  });
  wireSeg('recipient');

  // навигация
  document.querySelectorAll('.nav-item[data-screen]').forEach(b =>
    b.addEventListener('click', () => switchScreen(b.dataset.screen)));
  window.addEventListener('hashchange', () =>
    switchScreen(location.hash.slice(1), false));

  // календарь
  document.getElementById('cal-prev').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('cal-next').addEventListener('click', () => shiftMonth(1));
  document.getElementById('cal-today-btn').addEventListener('click', () => {
    calCursor = null;
    renderCalendar();
  });

  // кнопки
  document.getElementById('btn-add').addEventListener('click', openAddSheet);
  document.getElementById('btn-empty-add').addEventListener('click', openAddSheet);
  document.getElementById('btn-cancel').addEventListener('click', () => closeSheet('add-overlay'));
  document.getElementById('btn-save').addEventListener('click', submitHabit);
  document.getElementById('btn-day-summary').addEventListener('click', showDaySummary);
  document.getElementById('btn-summary').addEventListener('click', showDaySummary);
  document.getElementById('btn-summary-close').addEventListener('click', () => closeSheet('summary-overlay'));
  document.getElementById('btn-settle-close').addEventListener('click', () => closeSheet('settle-overlay'));
  document.getElementById('btn-day-close').addEventListener('click', () => closeSheet('day-overlay'));

  // профиль
  document.getElementById('btn-profile-edit').addEventListener('click', openProfileSheet);
  document.getElementById('pf-cancel').addEventListener('click', () => closeSheet('profile-overlay'));
  document.getElementById('pf-save').addEventListener('click', saveProfile);
  document.getElementById('set-offday').addEventListener('change', e => {
    settings.showOffday = e.target.checked;
    saveJson(SETTINGS_KEY, settings);
    renderHabits();
  });
  document.getElementById('btn-export').addEventListener('click', exportData);
  document.getElementById('btn-import').addEventListener('click', () =>
    document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', e => {
    if (e.target.files?.[0]) importData(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('btn-wipe').addEventListener('click', wipeData);

  // закрытие шторок: клик по затемнению и Esc
  document.querySelectorAll('.sheet-overlay').forEach(ov => {
    ov.addEventListener('click', e => {
      if (e.target === ov) closeSheet(ov.id);
    });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const open = anyOpenSheet();
      if (open) closeSheet(open.id);
    }
  });

  // стартовый экран из URL (deep link)
  switchScreen(location.hash.slice(1) || 'today', false);

  // автоитог прошедших дней
  const fresh = settlePastDays();
  render();
  if (fresh.length) showSettleModal(fresh);

  // подтягиваем данные с сервера, если он есть
  apiBootstrap();
}

document.addEventListener('DOMContentLoaded', init);
