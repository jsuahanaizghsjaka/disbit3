/* ============================================================
   disbit — логика прототипа
   Данные: localStorage; если открыто через бэкенд (http) —
   дополнительно синхронизируются с API (best-effort).
   Ставки (деньги/блокировка) — СИМУЛЯЦИЯ, ничего реального не происходит.
   ============================================================ */

const STORAGE_KEY = 'disbit_habits_v1';
const LEDGER_KEY  = 'disbit_ledger_v1';
const SETTLED_KEY = 'disbit_settled_v1';

// если страница открыта с сервера — работаем и с API
const API = location.protocol.startsWith('http') ? '/api' : null;

// наборы для выбора при создании привычки
const ICONS  = ['📚','💧','🏃','🧘','🦷','💪','🥗','😴','✍️','🎯','🧹','🎸'];
const COLORS = ['#3B82F6','#FB923C','#FBBF24','#F472B6','#34D399','#A78BFA','#22D3EE','#F87171'];
const DAY_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

const HEATMAP_WEEKS = 16;   // сколько недель показываем в статистике

let habits = load();
let ledger = loadLedger();
let editingId = null;         // id привычки в режиме редактирования (null = создаём)
let hmFilter = 'all';         // фильтр heatmap: 'all' или id привычки

/* ---------- ХРАНИЛИЩЕ ---------- */
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
  if (!h.createdAt) h.createdAt = dateKey();   // чтобы не насчитать штрафов задним числом
  h.history = h.history || {};
  h.counts  = h.counts  || {};
}
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(habits));
}
function loadLedger() {
  try {
    return JSON.parse(localStorage.getItem(LEDGER_KEY)) || [];
  } catch {
    return [];
  }
}
function saveLedger() {
  localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
}

/* ---------- API (best-effort синхронизация) ---------- */
// Все запросы «выстрелил и забыл»: UI работает мгновенно на localStorage,
// сервер догоняет. Ошибки сети не ломают приложение.
function apiCall(method, path, body) {
  if (!API) return Promise.resolve(null);
  return fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  }).then(r => (r.ok ? r.json().catch(() => null) : null))
    .catch(() => null);
}
// при старте: если сервер отвечает и на нём есть данные — берём их
async function apiBootstrap() {
  if (!API) return;
  const remote = await apiCall('GET', '/habits');
  if (Array.isArray(remote) && remote.length) {
    habits = remote;
    habits.forEach(migrate);
    save();
  } else if (Array.isArray(remote) && habits.length) {
    // сервер пуст, локально есть данные — заливаем их на сервер
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
// ключ дня в локальном времени: 'YYYY-MM-DD'
function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
// индекс дня недели: 0=Пн … 6=Вс
function dayIdx(d) {
  return (d.getDay() + 6) % 7;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
const TODAY = dateKey();

/* ---------- ЛОГИКА ПРИВЫЧЕК ---------- */

// запланирована ли привычка на данный день
function isScheduledOn(h, d) {
  return h.schedule.includes(dayIdx(d));
}
function isScheduledToday(h) {
  return isScheduledOn(h, new Date());
}

// выполнена ли привычка в конкретный день (key = 'YYYY-MM-DD')
function doneOn(h, key) {
  if (h.goal.type === 'count') {
    return (h.counts?.[key] || 0) >= h.goal.target;
  }
  return !!h.history?.[key];
}
function isDoneToday(h) {
  return doneOn(h, TODAY);
}

// текущий стрик: дни по расписанию подряд, незапланированные дни не рвут серию.
// если сегодня запланировано, но ещё не выполнено — считаем со вчера (не рвём)
function computeStreak(h) {
  let streak = 0;
  let d = new Date();
  if (isScheduledOn(h, d) && !doneOn(h, dateKey(d))) d = addDays(d, -1);

  for (let i = 0; i < 3660; i++) {           // ограничитель на всякий случай
    const key = dateKey(d);
    if (key < h.createdAt) break;             // раньше создания не заглядываем
    if (isScheduledOn(h, d)) {
      if (doneOn(h, key)) streak++;
      else break;
    }
    d = addDays(d, -1);
  }
  return streak;
}

// лучший стрик за всё время (от создания до сегодня)
function computeBestStreak(h) {
  let best = 0, cur = 0;
  let d = keyToDate(h.createdAt);
  const end = new Date();
  for (let i = 0; i < 3660 && d <= end; i++) {
    if (isScheduledOn(h, d)) {
      if (doneOn(h, dateKey(d))) {
        cur++;
        if (cur > best) best = cur;
      } else if (dateKey(d) !== TODAY) {      // сегодня ещё не провал
        cur = 0;
      }
    }
    d = addDays(d, 1);
  }
  return best;
}

// нажатие на кнопку отметки
function toggleHabit(id) {
  const h = habits.find(x => x.id === id);
  if (!h) return;

  if (h.goal.type === 'count') {
    const cur = h.counts[TODAY] || 0;
    h.counts[TODAY] = cur >= h.goal.target ? 0 : cur + 1;   // цикл: +1 … сброс
    h.history[TODAY] = h.counts[TODAY] >= h.goal.target;
  } else {
    h.history[TODAY] = !h.history[TODAY];
  }
  save();
  apiCall('PUT', `/habits/${id}/day/${TODAY}`, {
    done: doneOn(h, TODAY),
    count: h.counts[TODAY] || 0
  });
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
// При открытии приложения закрываем все дни с последнего визита по вчера:
// каждая запланированная и не выполненная привычка попадает в журнал списаний.
function settlePastDays() {
  const yesterday = dateKey(addDays(new Date(), -1));
  const last = localStorage.getItem(SETTLED_KEY);

  if (!last) {
    // первый запуск новой версии — задним числом ничего не начисляем
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
      if (h.createdAt > key) return;          // привычки ещё не было
      if (!isScheduledOn(h, d)) return;       // не по расписанию
      if (doneOn(h, key)) return;             // выполнена — всё хорошо
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

// модалка «Пока тебя не было» со свежими списаниями
function showSettleModal(entries) {
  const body = document.getElementById('settle-body');
  const money = entries.reduce((s, e) => s + e.amount, 0);
  const apps = new Set();
  entries.forEach(e => e.apps.forEach(a => apps.add(a)));

  let html = `<p style="color:var(--muted-2);font-size:14px;margin-bottom:14px">
    Пропущено привычек: <b style="color:var(--text)">${entries.length}</b></p>`;
  if (money) {
    html += `<div class="summary-total"><div class="amount">−${money}₽</div>
      <div class="label">списалось бы за пропуски</div></div>`;
  }
  if (apps.size) {
    html += `<div class="summary-row"><span class="big">🔒</span>
      <div><div>Заблокировались бы</div><b>${[...apps].map(escapeHtml).join(', ')}</b></div></div>`;
  }
  html += entries.slice(-8).reverse().map(e => `
    <div class="ledger-row">
      <span class="ledger-icon">${e.icon}</span>
      <div class="ledger-main">
        <div class="ledger-name">${escapeHtml(e.name)}</div>
        <div class="ledger-day">${formatDay(e.day)}</div>
      </div>
      <span class="ledger-amount">${e.mode === 'money' ? '−' + e.amount + '₽' : '🔒'}</span>
    </div>`).join('');

  body.innerHTML = html;
  document.getElementById('settle-overlay').hidden = false;
}

/* ---------- РЕНДЕР ---------- */

function render() {
  renderWeek();
  renderHabits();
  renderProgress();
  renderStats();
}

// полоска дней недели (Пн–Вс, сегодня выделено, прошедшие дни — с индикатором)
function renderWeek() {
  const now = new Date();
  const monday = addDays(now, -dayIdx(now));

  const box = document.getElementById('week-strip');
  box.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const key = dateKey(d);
    const isToday = key === TODAY;

    // индикатор дня: доля выполненных из запланированных
    let dot = '';
    if (key <= TODAY) {
      const sched = habits.filter(h => h.createdAt <= key && isScheduledOn(h, d));
      if (sched.length) {
        const done = sched.filter(h => doneOn(h, key)).length;
        const cls = done === sched.length ? 'full' : (done > 0 ? 'half' : (isToday ? '' : 'miss'));
        dot = `<i class="ddot ${cls}"></i>`;
      }
    }

    const el = document.createElement('div');
    el.className = 'day' + (isToday ? ' today' : '');
    el.innerHTML = `<span class="dname">${DAY_NAMES[i]}</span><span class="dnum">${d.getDate()}</span>${dot || '<i class="ddot none"></i>'}`;
    box.appendChild(el);
  }
}

// карточка привычки (для «Сегодня» и «Не сегодня»)
function habitCard(h, off) {
  const done = isDoneToday(h);
  const streak = computeStreak(h);

  let checkContent = '✓';
  if (!done && h.goal.type === 'count') checkContent = h.counts?.[TODAY] || 0;
  else if (!done) checkContent = '';

  const goalText = h.goal.type === 'count'
    ? `${h.counts?.[TODAY] || 0}/${h.goal.target} ${h.goal.unit || ''}`.trim()
    : '';

  const stake = h.stake.mode === 'money'
    ? `<span class="stake-badge money">💸 ${h.stake.amount}₽</span>`
    : `<span class="stake-badge lock">🔒 ${(h.stake.apps || []).length || ''} прил.</span>`;

  // подпись расписания для «не сегодня»
  const schedText = h.schedule.length === 7
    ? 'каждый день'
    : h.schedule.map(i => DAY_NAMES[i]).join(' · ');

  const card = document.createElement('div');
  card.className = 'habit' + (done ? ' done' : '') + (off ? ' off' : '');
  card.innerHTML = `
    <div class="habit-icon" style="background:${h.color}22">${h.icon}</div>
    <div class="habit-main" data-edit="${h.id}">
      <div class="habit-name">${escapeHtml(h.name)}</div>
      <div class="habit-meta">
        <span class="streak ${streak ? '' : 'zero'}">🔥 ${streak}</span>
        ${goalText && !off ? `<span class="goal-text">${goalText}</span>` : ''}
        ${off ? `<span class="goal-text">${schedText}</span>` : ''}
        ${stake}
      </div>
    </div>
    <button class="habit-del" data-del="${h.id}" title="Удалить">✕</button>
    ${off ? '' : `<button class="habit-check" data-check="${h.id}">${checkContent}</button>`}
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

  const todays = habits.filter(isScheduledToday);
  const off = habits.filter(h => !isScheduledToday(h));

  todays.forEach(h => list.appendChild(habitCard(h, false)));
  off.forEach(h => offList.appendChild(habitCard(h, true)));
  offBlock.hidden = off.length === 0;

  // обработчики
  document.querySelectorAll('#screen-today [data-check]').forEach(b =>
    b.addEventListener('click', () => toggleHabit(b.dataset.check)));
  document.querySelectorAll('#screen-today [data-del]').forEach(b =>
    b.addEventListener('click', () => deleteHabit(b.dataset.del)));
  document.querySelectorAll('#screen-today [data-edit]').forEach(b =>
    b.addEventListener('click', () => openEditSheet(b.dataset.edit)));
}

function renderProgress() {
  // прогресс и риск считаем только по запланированным на сегодня
  const todays = habits.filter(isScheduledToday);
  const total = todays.length;
  const done = todays.filter(isDoneToday).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  document.getElementById('done-count').textContent = done;
  document.getElementById('total-count').textContent = total;
  document.getElementById('ring-label').textContent = pct + '%';

  const C = 327;   // окружность кольца: 2π·52
  document.getElementById('ring-fg').style.strokeDashoffset = C - (C * pct) / 100;

  const notDone = todays.filter(h => !isDoneToday(h));
  const money = notDone
    .filter(h => h.stake.mode === 'money')
    .reduce((s, h) => s + Number(h.stake.amount || 0), 0);
  const locks = notDone.filter(h => h.stake.mode === 'lock').length;

  const parts = [];
  if (money) parts.push(`${money}₽`);
  if (locks) parts.push(`${locks} блокир.`);
  document.getElementById('at-risk').textContent =
    parts.length ? `⚠️ Под риском: ${parts.join(' + ')}` : '';
}

/* ---------- ЭКРАН СТАТИСТИКИ ---------- */

function renderStats() {
  // сводные карточки
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

// чипы-фильтры heatmap: «Все» + каждая привычка
function renderHmChips() {
  const box = document.getElementById('hm-chips');
  box.innerHTML = '';
  const mk = (id, label) => {
    const b = document.createElement('button');
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

// уровень ячейки heatmap для дня
// возвращает класс: off | future | fail | l0 | l1 | l2 | l3
function hmLevel(d) {
  const key = dateKey(d);
  if (key > TODAY) return 'future';

  const pool = hmFilter === 'all' ? habits : habits.filter(h => h.id === hmFilter);
  const sched = pool.filter(h => h.createdAt <= key && isScheduledOn(h, d));
  if (!sched.length) return 'off';

  const done = sched.filter(h => doneOn(h, key)).length;
  const ratio = done / sched.length;

  if (ratio === 0) return key === TODAY ? 'l0' : 'fail';   // сегодня ещё не провал
  if (ratio === 1) return 'l3';
  return ratio >= 0.5 ? 'l2' : 'l1';
}

function renderHeatmap() {
  const box = document.getElementById('heatmap');
  box.innerHTML = '';
  document.getElementById('hm-weeks-label').textContent = `последние ${HEATMAP_WEEKS} недель`;

  // столбцы = недели (старые слева), строки = Пн…Вс
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

// список стриков по привычкам
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
        <div class="ledger-day">лучший: 🏆 ${best}</div>
      </div>
      <span class="streak-big ${cur ? '' : 'zero'}">🔥 ${cur}</span>
    </div>`).join('');
}

// журнал списаний
function renderLedger() {
  const box = document.getElementById('ledger-list');
  if (!ledger.length) {
    box.innerHTML = `<p class="hint">Пока пусто — ни одного пропуска. Так держать! 💪</p>`;
    return;
  }
  box.innerHTML = ledger.slice(-30).reverse().map(e => `
    <div class="ledger-row">
      <span class="ledger-icon">${e.icon || '❌'}</span>
      <div class="ledger-main">
        <div class="ledger-name">${escapeHtml(e.name || '')}</div>
        <div class="ledger-day">${formatDay(e.day)}</div>
      </div>
      <span class="ledger-amount">${e.mode === 'money'
        ? `−${e.amount}₽ ${e.recipient === 'charity' ? '❤️' : '🛠️'}`
        : `🔒 ${(e.apps || []).length}`}</span>
    </div>`).join('');
}

/* ---------- ПЕРЕКЛЮЧЕНИЕ ЭКРАНОВ ---------- */
function switchScreen(name) {
  document.querySelectorAll('.screen').forEach(s =>
    s.classList.toggle('active', s.id === 'screen-' + name));
  document.querySelectorAll('.nav-item[data-screen]').forEach(b =>
    b.classList.toggle('active', b.dataset.screen === name));
  if (name === 'stats') renderStats();
}

/* ---------- ШТОРКА ДОБАВЛЕНИЯ / РЕДАКТИРОВАНИЯ ---------- */

function buildPickers() {
  const ip = document.getElementById('icon-picker');
  const cp = document.getElementById('color-picker');
  ip.innerHTML = '';
  cp.innerHTML = '';

  ICONS.forEach((ic, i) => {
    const b = document.createElement('button');
    b.className = 'pick' + (i === 0 ? ' selected' : '');
    b.textContent = ic;
    b.dataset.icon = ic;
    b.addEventListener('click', () => selectIn(ip, b));
    ip.appendChild(b);
  });
  COLORS.forEach((col, i) => {
    const b = document.createElement('button');
    b.className = 'pick color' + (i === 0 ? ' selected' : '');
    b.style.background = col;
    b.dataset.color = col;
    b.addEventListener('click', () => selectIn(cp, b));
    cp.appendChild(b);
  });
}
function selectIn(container, btn) {
  container.querySelectorAll('.pick').forEach(p => p.classList.remove('selected'));
  btn.classList.add('selected');
}

// пикер дней недели (мультивыбор)
function buildDayPicker(selected = [0,1,2,3,4,5,6]) {
  const dp = document.getElementById('day-picker');
  dp.innerHTML = '';
  DAY_NAMES.forEach((n, i) => {
    const b = document.createElement('button');
    b.className = 'dpick' + (selected.includes(i) ? ' selected' : '');
    b.textContent = n;
    b.dataset.day = i;
    b.addEventListener('click', () => b.classList.toggle('selected'));
    dp.appendChild(b);
  });
}
function selectedDays() {
  return [...document.querySelectorAll('#day-picker .dpick.selected')]
    .map(b => Number(b.dataset.day));
}

// общий обработчик сегментов-переключателей
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

// открыть шторку для СОЗДАНИЯ новой привычки
function openAddSheet() {
  editingId = null;
  document.getElementById('add-title').textContent = 'Новая привычка';
  document.getElementById('btn-save').textContent = 'Создать привычку';
  resetAddForm();
  document.getElementById('add-overlay').hidden = false;
}

// открыть ту же шторку для РЕДАКТИРОВАНИЯ существующей
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

  // цель
  setSegActive('goal-type', 'goal', h.goal.type);
  document.getElementById('count-fields').hidden = h.goal.type !== 'count';
  document.getElementById('f-target').value = h.goal.target || 5;
  document.getElementById('f-unit').value = h.goal.unit || '';

  // ставка
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

  document.getElementById('add-overlay').hidden = false;
}

function closeAddSheet() {
  document.getElementById('add-overlay').hidden = true;
  editingId = null;
}

// выбрать нужную иконку/цвет в пикере
function setPickSelected(containerId, attr, value) {
  document.getElementById(containerId)
    .querySelectorAll('.pick')
    .forEach(p => p.classList.toggle('selected', p.dataset[attr] === value));
}
// сделать активным нужный сегмент-переключатель
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

// сохранить: создать новую привычку или обновить редактируемую
function submitHabit() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { alert('Введите название привычки'); return; }

  const schedule = selectedDays();
  if (!schedule.length) { alert('Выбери хотя бы один день недели'); return; }

  const goalType = segValue('goal-type', 'goal');
  const stakeMode = segValue('stake-mode', 'stake');

  // данные из формы (без id/counts/history — их не трогаем при редактировании)
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
    // обновляем существующую, сохраняя прогресс (counts/history/id/createdAt)
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
  closeAddSheet();
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
    body.innerHTML = `<div class="summary-ok">🎉 Все привычки выполнены!<br/>Ничего бы не списалось.</div>`;
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

    let html = `<p style="color:var(--muted-2);font-size:14px;margin-bottom:14px">
      Не выполнено привычек: <b style="color:var(--text)">${notDone.length}</b></p>`;

    if (total > 0) {
      html += `<div class="summary-total"><div class="amount">${total}₽</div>
        <div class="label">спишется, если не выполнить до конца дня</div></div>`;
      if (charity) html += `<div class="summary-row"><span class="big">❤️</span>
        <div><div>Благотворительность</div><b>${charity}₽</b></div></div>`;
      if (creators) html += `<div class="summary-row"><span class="big">🛠️</span>
        <div><div>Создателям</div><b>${creators}₽</b></div></div>`;
    }
    if (apps.size) {
      html += `<div class="summary-row"><span class="big">🔒</span>
        <div><div>Заблокируются приложения</div>
        <b>${[...apps].map(escapeHtml).join(', ')}</b></div></div>`;
    }
    body.innerHTML = html;
  }
  document.getElementById('summary-overlay').hidden = false;
}

/* ---------- УТИЛИТЫ ---------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// '2026-07-09' → 'чт, 9 июля'
function formatDay(key) {
  return keyToDate(key).toLocaleDateString('ru-RU',
    { weekday: 'short', day: 'numeric', month: 'long' });
}

/* ---------- ИНИЦИАЛИЗАЦИЯ ---------- */
function init() {
  document.getElementById('header-date').textContent = formatDay(TODAY);

  buildPickers();
  buildDayPicker();

  // сегменты
  wireSeg('goal-type', btn => {
    document.getElementById('count-fields').hidden = btn.dataset.goal !== 'count';
  });
  wireSeg('stake-mode', btn => {
    const money = btn.dataset.stake === 'money';
    document.getElementById('stake-money').hidden = !money;
    document.getElementById('stake-lock').hidden = money;
  });
  wireSeg('recipient');

  // нижняя навигация
  document.querySelectorAll('.nav-item[data-screen]').forEach(b =>
    b.addEventListener('click', () => switchScreen(b.dataset.screen)));

  // кнопки
  document.getElementById('btn-add').addEventListener('click', openAddSheet);
  document.getElementById('btn-cancel').addEventListener('click', closeAddSheet);
  document.getElementById('btn-save').addEventListener('click', submitHabit);
  document.getElementById('btn-day-summary').addEventListener('click', showDaySummary);
  document.getElementById('btn-summary').addEventListener('click', showDaySummary);
  document.getElementById('btn-summary-close').addEventListener('click', () => {
    document.getElementById('summary-overlay').hidden = true;
  });
  document.getElementById('btn-settle-close').addEventListener('click', () => {
    document.getElementById('settle-overlay').hidden = true;
  });

  // закрытие шторок по клику на затемнение
  ['add-overlay','summary-overlay','settle-overlay'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      if (e.target.id === id) {
        document.getElementById(id).hidden = true;
        if (id === 'add-overlay') editingId = null;
      }
    });
  });

  // автоитог прошедших дней
  const fresh = settlePastDays();
  render();
  if (fresh.length) showSettleModal(fresh);

  // подтягиваем данные с сервера, если он есть
  apiBootstrap();
}

document.addEventListener('DOMContentLoaded', init);
