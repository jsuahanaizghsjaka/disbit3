/* ============================================================
   disbit — логика приложения (v0.4)
   Главная идея: не ставки, а ШТРАФЫ за пропуск привычки.
   Грейс-день: один пропуск серию не рвёт, два подряд — рвёт.
   «Минимум» — запасной вариант, продлевающий дисциплину.
   Данные: localStorage; при работе через бэкенд (http) —
   best-effort синхронизация с API. Штрафы — СИМУЛЯЦИЯ.
   ============================================================ */

const STORAGE_KEY  = 'disbit_habits_v1';
const LEDGER_KEY   = 'disbit_ledger_v1';
const SETTLED_KEY  = 'disbit_settled_v1';
const PROFILE_KEY  = 'disbit_profile_v1';
const SETTINGS_KEY = 'disbit_settings_v1';
const FRIENDS_KEY  = 'disbit_friends_v1';
const GOALS_KEY    = 'disbit_goals_v1';
const REWARDS_KEY  = 'disbit_rewards_v1';
const BACKLOG_KEY  = 'disbit_backlog_v1';
const TOKEN_KEY    = 'disbit_token_v1';
const AUTH_USER_KEY = 'disbit_auth_user_v1';

// с Vercel-статики ходим на Railway-бэкенд; на самом Railway и localhost — тот же origin
const API_HOST = location.hostname.endsWith('vercel.app')
  ? 'https://disbit3-production.up.railway.app'
  : '';
const API = location.protocol.startsWith('http') ? API_HOST + '/api' : null;

/* ---------- АККАУНТ (Bearer-токен) ---------- */
let authToken = localStorage.getItem(TOKEN_KEY) || null;
let authUser = null;
try { authUser = JSON.parse(localStorage.getItem(AUTH_USER_KEY)); } catch { authUser = null; }
let authMode = 'login';   // 'login' | 'register'

function setAuth(token, user) {
  authToken = token;
  authUser = user;
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
  }
}

// иконки привычек — монохромные SVG из спрайта (старые эмодзи-привычки поддерживаются)
const HABIT_ICONS = ['svg:i-h-book','svg:i-h-water','svg:i-h-run','svg:i-h-sleep','svg:i-h-food','svg:i-h-gym','svg:i-h-music','svg:i-h-lang','svg:i-h-mind','svg:i-h-clean','svg:i-h-code','svg:i-h-health'];
// рендер иконки привычки/записи: svg-ссылка или старое эмодзи
function iconOf(v) {
  return String(v || '').startsWith('svg:') ? icon(v.slice(4)) : escapeHtml(v || '');
}

// медали достижений
const MEDALS = [
  ...[100,200,300,400,500,600,700,800,900,1000].map(n =>
    ({ id: 's' + n, kind: 'streak', at: n, name: `${n} дней`, cls: 'gold', ic: 'i-flame' })),
  ...[1000,2500,5000,10000].map(n =>
    ({ id: 'f' + n, kind: 'fines', at: n, name: `${n}₽ штрафов`, cls: 'red', ic: 'i-coins' })),
  ...[5,10,20].map(n =>
    ({ id: 'l' + n, kind: 'locks', at: n, name: `${n} блокировок`, cls: 'violet', ic: 'i-lock' })),
  // марафоны: доведённые до финиша
  ...[
    { at: 1,  name: 'Первый финиш' },
    { at: 3,  name: '3 марафона'   },
    { at: 5,  name: '5 марафонов'  },
    { at: 10, name: '10 марафонов' }
  ].map(m => ({ id: 'm' + m.at, kind: 'marathons', at: m.at, name: m.name, cls: 'blue', ic: 'i-target' })),
  // шаги, пройденные путником во всех марафонах
  ...[100,500,1000].map(n =>
    ({ id: 'ms' + n, kind: 'steps', at: n, name: `${n} шагов`, cls: 'blue', ic: 'i-h-run' }))
];
const COLORS = ['#5B8DFF','#4ADE80','#38BDF8','#F472B6','#A78BFA','#F87171','#FBBF24','#E8722A'];
const AVA_EMOJIS = ['😀','😎','🦊','🐻','🐼','🦁','🐯','🐸','🦉','🐨','🦄','🐢','🚀','🔥','⚡','🌟','🍀','🌊','🎧','🎮','🏔️','🌙','🍕','☕'];
const DAY_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const SCREENS = ['today','calendar','stats','profile'];

// темы приложения: id → цвет свотча
const THEMES = [
  { id: 'blue',   c: '#5B8DFF' },
  { id: 'red',    c: '#E06060' },
  { id: 'black',  c: '#2A2C31' },
  { id: 'white',  c: '#E9EDF3' },
  { id: 'yellow', c: '#D4A528' },
  { id: 'orange', c: '#E8722A' },
  { id: 'green',  c: '#3EBE7D' },
  { id: 'purple', c: '#9D7BFA' }
];

const HEATMAP_WEEKS = 16;

let habits   = load();
let ledger   = loadLedger();
let profile  = loadJson(PROFILE_KEY, {
  name: '', color: COLORS[0], createdAt: null,
  photo: null, emoji: null,
  motivation: { level: 50, text: '' }
});
let settings = loadJson(SETTINGS_KEY, { showOffday: true, theme: 'blue' });
let friends  = loadArr(FRIENDS_KEY);
let goals    = loadArr(GOALS_KEY);
let rewards  = loadArr(REWARDS_KEY);
let backlog  = loadArr(BACKLOG_KEY);

let editingId = null;        // привычка в редактировании
let editingGoalId = null;    // цель в редактировании
let pendingBacklogId = null; // идея, превращаемая в привычку
let hmFilter  = 'all';
let calCursor = null;
let daySheetKey = null;
let avaDraft = {};           // черновик аватара в шторке профиля

/* ---------- SVG-ИКОНКИ ---------- */
function icon(id, cls = 'ic') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
}

/* ---------- ХРАНИЛИЩЕ ---------- */
function loadJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && typeof v === 'object' && !Array.isArray(v) ? { ...fallback, ...v } : fallback;
  } catch {
    return fallback;
  }
}
function loadArr(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
/* ---------- СИНК СОСТОЯНИЯ (profile/goals/rewards/friends/backlog/settings) ---------- */
const STATE_TS_KEY = 'disbit_state_ts_v1';
const SYNC_KEYS = new Set([PROFILE_KEY, SETTINGS_KEY, GOALS_KEY, REWARDS_KEY, FRIENDS_KEY, BACKLOG_KEY]);
let applyingRemote = false;   // применяем серверный стейт — не эхо-пушим
let statePushTimer = null;

function stateBlob() {
  return {
    profile, settings, goals, rewards, friends, backlog,
    settled: localStorage.getItem(SETTLED_KEY)
  };
}
function touchStateTs() {
  localStorage.setItem(STATE_TS_KEY, String(Date.now()));
}
function scheduleStatePush() {
  if (!API || applyingRemote) return;
  clearTimeout(statePushTimer);
  statePushTimer = setTimeout(() => {
    apiCall('PUT', '/state', {
      data: stateBlob(),
      ts: Number(localStorage.getItem(STATE_TS_KEY)) || Date.now()
    });
  }, 800);
}
// применяем серверный блоб поверх локального
function applyRemoteState(data, ts) {
  applyingRemote = true;
  try {
    if (data.profile && typeof data.profile === 'object') profile = { ...profile, ...data.profile };
    if (data.settings && typeof data.settings === 'object') settings = { ...settings, ...data.settings };
    goals   = Array.isArray(data.goals)   ? data.goals   : goals;
    rewards = Array.isArray(data.rewards) ? data.rewards : rewards;
    friends = Array.isArray(data.friends) ? data.friends : friends;
    backlog = Array.isArray(data.backlog) ? data.backlog : backlog;
    if (data.settled && data.settled > (localStorage.getItem(SETTLED_KEY) || '')) {
      localStorage.setItem(SETTLED_KEY, data.settled);
    }
    saveJson(PROFILE_KEY, profile);
    saveJson(SETTINGS_KEY, settings);
    saveJson(GOALS_KEY, goals);
    saveJson(REWARDS_KEY, rewards);
    saveJson(FRIENDS_KEY, friends);
    saveJson(BACKLOG_KEY, backlog);
    localStorage.setItem(STATE_TS_KEY, String(ts || Date.now()));
    applyTheme();
  } finally {
    applyingRemote = false;
  }
}

function saveJson(key, v) {
  localStorage.setItem(key, JSON.stringify(v));
  if (SYNC_KEYS.has(key) && !applyingRemote) {
    touchStateTs();
    scheduleStatePush();
  }
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
function migrate(h) {
  if (!Array.isArray(h.schedule) || !h.schedule.length) h.schedule = [0,1,2,3,4,5,6];
  if (!h.createdAt) h.createdAt = dateKey();
  if (typeof h.min !== 'string') h.min = '';
  h.history = h.history || {};
  h.counts  = h.counts  || {};
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(habits)); }
function loadLedger() {
  try { return JSON.parse(localStorage.getItem(LEDGER_KEY)) || []; }
  catch { return []; }
}
function saveLedger() { localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger)); }

/* ---------- API (best-effort) ---------- */
function apiCall(method, path, body) {
  if (!API) return Promise.resolve(null);
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers.Authorization = 'Bearer ' + authToken;
  return fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  }).then(r => (r.ok ? r.json().catch(() => null) : null))
    .catch(() => null);
}
// как apiCall, но возвращает и ошибки сервера — для форм входа/регистрации
async function apiCallStrict(method, path, body) {
  if (!API) return { error: 'Аккаунты работают при запуске с сервером disbit' };
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers.Authorization = 'Bearer ' + authToken;
    const r = await fetch(API + path, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { error: data.error || ('Ошибка ' + r.status) };
    return data;
  } catch {
    return { error: 'Сервер недоступен' };
  }
}
async function apiBootstrap() {
  if (!API) return;
  // проверяем токен: протух — выходим в гостевой режим
  if (authToken) {
    const me = await apiCall('GET', '/auth/me');
    if (me?.user) {
      authUser = me.user;
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(me.user));
    } else {
      setAuth(null, null);
    }
    renderAccount();
  }
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
  // стейт профиля: применяем серверный, только если он новее локального
  if (authToken) {
    const st = await apiCall('GET', '/state');
    const localTs = Number(localStorage.getItem(STATE_TS_KEY)) || 0;
    if (st?.data && Number(st.updatedAt) > localTs) {
      applyRemoteState(st.data, st.updatedAt);
    } else {
      scheduleStatePush();   // на сервере пусто/старее — заливаем своё
    }
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
function dayIdx(d) { return (d.getDay() + 6) % 7; }
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
const TODAY = dateKey();

/* ---------- ЛОГИКА ПРИВЫЧЕК ---------- */
function isScheduledOn(h, d) { return h.schedule.includes(dayIdx(d)); }
function isScheduledToday(h) { return isScheduledOn(h, new Date()); }

// выполнена ли (полностью или «минимумом»)
function doneOn(h, key) {
  if (h.history?.[key] === 'min') return true;
  if (h.goal.type === 'count') return (h.counts?.[key] || 0) >= h.goal.target;
  return !!h.history?.[key];
}
function isMinOn(h, key) { return h.history?.[key] === 'min'; }
function isDoneToday(h) { return doneOn(h, TODAY); }

// ТЕКУЩИЙ СТРИК с грейс-днём: один пропуск не рвёт серию,
// два запланированных пропуска подряд — рвут.
function computeStreak(h) {
  let streak = 0, misses = 0;
  let d = new Date();
  if (isScheduledOn(h, d) && !doneOn(h, dateKey(d))) d = addDays(d, -1); // сегодня не судим

  for (let i = 0; i < 3660; i++) {
    const key = dateKey(d);
    if (key < h.createdAt) break;
    if (isScheduledOn(h, d)) {
      if (doneOn(h, key)) { streak++; misses = 0; }
      else { misses++; if (misses >= 2) break; }
    }
    d = addDays(d, -1);
  }
  return streak;
}

// лучший стрик за всё время (с тем же грейс-правилом)
function computeBestStreak(h) {
  let best = 0, cur = 0, misses = 0;
  let d = keyToDate(h.createdAt);
  const end = new Date();
  for (let i = 0; i < 3660 && d <= end; i++) {
    const key = dateKey(d);
    if (isScheduledOn(h, d)) {
      if (doneOn(h, key)) {
        cur++; misses = 0;
        if (cur > best) best = cur;
      } else if (key !== TODAY) {
        misses++;
        if (misses >= 2) cur = 0;
      }
    }
    d = addDays(d, 1);
  }
  return best;
}

// отметка за произвольный день
function setDayMark(h, key, { done, count }) {
  if (h.goal.type === 'count') {
    h.counts[key] = Math.max(0, Math.min(999, count ?? 0));
    h.history[key] = h.counts[key] >= h.goal.target
      ? true
      : (h.history[key] === 'min' ? 'min' : false);
  } else {
    h.history[key] = !!done;
  }
  save();
  apiCall('PUT', `/habits/${h.id}/day/${key}`, {
    done: doneOn(h, key),
    count: h.counts[key] || 0
  });
}

// отметка «сделал минимум» (вкл/выкл)
function toggleMinMark(h, key) {
  if (h.history[key] === 'min') {
    h.history[key] = false;
  } else if (!doneOn(h, key)) {
    h.history[key] = 'min';
  }
  save();
  apiCall('PUT', `/habits/${h.id}/day/${key}`, {
    done: doneOn(h, key),
    count: h.counts?.[key] || 0
  });
}

function todayPct() {
  const todays = habits.filter(isScheduledToday);
  if (!todays.length) return 0;
  return Math.round((todays.filter(isDoneToday).length / todays.length) * 100);
}

const PRAISES = [
  'Красавчик! Все привычки дня закрыты 🎉',
  'Идеальный день! Так и куётся дисциплина 🔥',
  '100%! Штрафам сегодня ничего не светит 💪',
  'День закрыт полностью. Гордись собой ⭐'
];

function toggleHabit(id) {
  const h = habits.find(x => x.id === id);
  if (!h) return;
  const wasFull = todayPct() === 100;
  if (h.goal.type === 'count') {
    const cur = h.counts[TODAY] || 0;
    setDayMark(h, TODAY, { count: cur >= h.goal.target ? 0 : cur + 1 });
  } else {
    setDayMark(h, TODAY, { done: h.history[TODAY] === 'min' ? true : !h.history[TODAY] });
  }
  render();
  if (!wasFull && todayPct() === 100) {
    toast(PRAISES[Math.floor(Math.random() * PRAISES.length)]);
  }
}

function deleteHabit(id) {
  if (!confirm('Удалить привычку?')) return;
  habits = habits.filter(x => x.id !== id);
  save();
  // привычка могла быть в марафоне — отвязываем, иначе марафон считал бы мёртвый id
  let touched = false;
  goals.forEach(g => {
    if ((g.habitIds || []).includes(id)) {
      g.habitIds = g.habitIds.filter(x => x !== id);
      touched = true;
    }
  });
  if (touched) saveJson(GOALS_KEY, goals);
  apiCall('DELETE', `/habits/${id}`);
  render();
}

/* ---------- ТОСТ ПОХВАЛЫ ---------- */
let toastTimer = null;
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

/* ---------- АВТОИТОГ ПРОШЕДШИХ ДНЕЙ (ШТРАФЫ) ---------- */
function settlePastDays() {
  const yesterday = dateKey(addDays(new Date(), -1));
  const last = localStorage.getItem(SETTLED_KEY);

  if (!last) {
    localStorage.setItem(SETTLED_KEY, yesterday);
  touchStateTs();
  scheduleStatePush();
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
  touchStateTs();
  scheduleStatePush();
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
      <div class="label">штрафов за пропуски</div></div>`;
  }
  if (apps.size) {
    html += `<div class="summary-row"><span class="big lock">${icon('i-lock')}</span>
      <div><div>Заблокировались бы</div><b>${[...apps].map(escapeHtml).join(', ')}</b></div></div>`;
  }
  html += entries.slice(-8).reverse().map(e => `
    <div class="ledger-row">
      <span class="ledger-icon">${iconOf(e.icon)}</span>
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
  renderRewardBanner();
  renderMarathonPromo();
  renderWalker();
  renderWeek();
  renderHabits();
  renderProgress();
  renderCalendar();
  renderGoals();
  renderBacklog();
  renderStats();
  renderProfile();
}

/* ---------- БАННЕР НАГРАДЫ ---------- */
function bestCurrentStreak() {
  return habits.length ? Math.max(...habits.map(computeStreak)) : 0;
}
function availableReward() {
  const streak = bestCurrentStreak();
  return rewards
    .filter(r => !r.claimed && r.days <= streak)
    .sort((a, b) => b.days - a.days)[0] || null;
}
function renderRewardBanner() {
  const box = document.getElementById('reward-banner');
  const r = availableReward();
  if (!r) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = `
    <div class="reward-banner">
      ${icon('i-gift')}
      <div class="rb-main">
        <div class="rb-title">Серия ${r.days} дн. — награда доступна!</div>
        <div class="rb-sub">${escapeHtml(r.text)}</div>
      </div>
      <button data-claim="${r.id}">Получил</button>
    </div>`;
  box.querySelector('[data-claim]').addEventListener('click', () => {
    r.claimed = true;
    saveJson(REWARDS_KEY, rewards);
    render();
    toast('Заслуженно! Наслаждайся наградой 🏆');
  });
}

/* ---------- ПРОМО МАРАФОНА ----------
   Новичок должен увидеть фичу сразу после регистрации, не раскапывая настройки.
   Как только первый марафон запущен — промо исчезает навсегда. */
function renderMarathonPromo() {
  const box = document.getElementById('marathon-promo');
  if (!box) return;
  if (goals.some(isMarathon)) { box.hidden = true; box.innerHTML = ''; return; }

  box.hidden = false;
  box.innerHTML = `
    <section class="promo-card">
      <div class="promo-art">${icon('i-h-run', 'ic ic-xl')}</div>
      <div class="promo-main">
        <h3 class="promo-title">Запусти марафон</h3>
        <p class="promo-text">Выбери большую цель и сколько до неё шагов.
          Каждая выполненная привычка — шаг путника вперёд. Дойдёшь — финиш и медаль.</p>
        <button class="btn-primary promo-cta" id="promo-start">Создать марафон</button>
      </div>
    </section>`;
  box.querySelector('#promo-start').addEventListener('click', () => openGoalSheet());
}

/* ---------- ПУТНИК: сцена прогресса большой цели ---------- */
/* 1 выполненная привычка = 1 шаг. Позицию считаем из истории отметок, а не
   инкрементом по нажатию: снял отметку — путник честно отступает назад,
   рассинхрон невозможен. Финал зависит от сцены: лента или пьедестал. */
const SCENES = [
  {
    id: 'desert',
    name: 'Пустыня',
    finish: 'ribbon',                              // 'ribbon' | 'podium'
    sky: ['#16203A', '#43354F', '#8E6A55'],        // приглушённые сумерки — не режет глаза
    sun: '#D99A57',
    far: '#33304A',
    mid: '#4B4057',
    ground: '#6A5443',
    gear: 'hat'                                    // экипировка под сцену
  }
];
function sceneOf(g) { return SCENES.find(s => s.id === g?.scene) || SCENES[0]; }

/* Марафон считает ТОЛЬКО свои привычки (g.habitIds), а не все подряд.
   Правило: одна привычка живёт максимум в одном марафоне, в марафоне — до 5 привычек. */
const MARATHON_MAX_HABITS = 5;

function isMarathon(g) { return g?.steps > 0; }
function marathonHabits(g) {
  const ids = new Set(g?.habitIds || []);
  return habits.filter(h => ids.has(h.id));
}
// привычка занята другим марафоном? (кроме текущего — его привычки свободны для него же)
function habitTakenBy(habitId, exceptGoalId = null) {
  return goals.find(g => isMarathon(g) && g.id !== exceptGoalId && (g.habitIds || []).includes(habitId));
}
// огонёк марафона: лучшая текущая серия среди его привычек
function marathonStreak(g) {
  const hs = marathonHabits(g);
  return hs.length ? Math.max(...hs.map(computeStreak)) : 0;
}

// пройдено шагов = выполненные отметки привычек ЭТОГО марафона с момента старта
function stepsDone(g) {
  const from = g.startedAt || '0000-00-00';
  let n = 0;
  for (const h of marathonHabits(g)) {
    const days = new Set([...Object.keys(h.history || {}), ...Object.keys(h.counts || {})]);
    for (const key of days) {
      if (key >= from && doneOn(h, key)) n++;
    }
  }
  return n;
}
// сколько шагов пройдено во всех марафонах вместе — для медалей
function totalSteps() {
  return goals.filter(isMarathon).reduce((s, g) => s + stepsDone(g), 0);
}
// прогресс цели: с путником — авто (из шагов), без него — ручной, как раньше
function goalPct(g) {
  if (g.steps > 0) {
    return Math.max(0, Math.min(100, Math.round((stepsDone(g) / g.steps) * 100)));
  }
  return Math.max(0, Math.min(100, g.progress || 0));
}

// фигурка путника: экипировка зависит от сцены
function walkerFigure(sc) {
  const hat = sc.gear === 'hat'
    ? `<path class="w-hat" d="M-7,-27 L7,-27 M-4.5,-27 Q0,-33 4.5,-27" />`
    : '';
  return `
    <g class="w-man">
      <g class="w-body">
        <circle class="w-head" cx="0" cy="-25" r="4.6" />
        ${hat}
        <path class="w-pack" d="M-2,-20 L-6,-20 L-6,-13 L-2,-13 Z" />
        <path class="w-torso" d="M0,-20 L0,-10" />
        <path class="w-arm w-arm-b" d="M0,-18 L-5,-12" />
        <path class="w-arm w-arm-f" d="M0,-18 L5,-12" />
        <path class="w-leg w-leg-b" d="M0,-10 L-4,0" />
        <path class="w-leg w-leg-f" d="M0,-10 L4,0" />
      </g>
    </g>`;
}

// финиш сцены: лента с флажками или пьедестал
function walkerFinish(sc) {
  if (sc.finish === 'podium') {
    return `
      <g class="w-finish">
        <rect x="286" y="92" width="22" height="12" rx="2" class="w-podium" />
        <path class="w-flagline" d="M297,92 L297,82" />
      </g>`;
  }
  return `
    <g class="w-finish">
      <path class="w-post" d="M292,104 L292,78" />
      <path class="w-ribbon" d="M292,84 L308,84" />
      <path class="w-flag" d="M292,78 L302,81 L292,84 Z" />
    </g>`;
}

// сцену строим ОДИН раз и дальше только двигаем путника: если пересоздавать
// разметку на каждый render(), CSS-transition не с чего анимировать — фигурка
// будет телепортироваться вместо шага
function walkerSceneHtml(g, sc) {
  return `
    <section class="walker-card" data-goal="${g.id}" data-scene="${sc.id}">
      <header class="w-head">
        <h3 class="w-goal"></h3>
        <span class="w-flame" title="Серия — не рви её"></span>
      </header>

      <svg class="w-scene" viewBox="0 0 320 132" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="w-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${sc.sky[0]}"/>
            <stop offset="0.55" stop-color="${sc.sky[1]}"/>
            <stop offset="1" stop-color="${sc.sky[2]}"/>
          </linearGradient>
        </defs>

        <rect width="320" height="132" fill="url(#w-sky)"/>
        <circle class="w-sun" cx="246" cy="72" r="13" fill="${sc.sun}"/>

        <!-- дальние барханы -->
        <path fill="${sc.far}" d="M0,92 Q46,74 92,90 Q140,104 190,86 Q244,68 320,88 L320,132 L0,132 Z"/>
        <!-- ближние барханы -->
        <path fill="${sc.mid}" d="M0,106 Q60,92 118,104 Q182,116 240,100 Q286,88 320,102 L320,132 L0,132 Z"/>
        <!-- земля, по которой идёт путник -->
        <rect y="104" width="320" height="28" fill="${sc.ground}"/>

        ${walkerFinish(sc)}
        <g class="w-walker">${walkerFigure(sc)}</g>

        <g class="w-confetti">
          <circle cx="276" cy="60" r="2"/><circle cx="292" cy="52" r="2"/>
          <circle cx="308" cy="62" r="2"/><circle cx="284" cy="46" r="1.6"/>
        </g>
      </svg>

      <header class="w-head">
        <h3 class="w-goal"></h3>
        <span class="w-flame" title="Серия — не рви её"></span>
      </header>

      <div class="w-foot">
        <div class="w-bar"><div class="w-fill"></div></div>
        <div class="w-sub">
          <span class="w-steps"></span>
          <span class="w-left"></span>
        </div>
      </div>
    </section>`;
}

let walkerWalkTimer = null;
function renderWalker() {
  const box = document.getElementById('walker');
  // ведём первую недошедшую цель с шагами; если все дошли — показываем последнюю
  const g = goals.find(x => x.steps > 0 && goalPct(x) < 100)
         || goals.find(x => x.steps > 0);
  if (!g) { box.hidden = true; box.innerHTML = ''; return; }

  const sc = sceneOf(g);
  const total = g.steps;
  const done = Math.min(stepsDone(g), total);
  const finished = goalPct(g) >= 100;

  // сцена пересобирается, только если сменилась цель или фон
  let card = box.querySelector('.walker-card');
  const stale = !card || card.dataset.goal !== g.id || card.dataset.scene !== sc.id;
  if (stale) {
    box.innerHTML = walkerSceneHtml(g, sc);
    card = box.querySelector('.walker-card');
  }
  box.hidden = false;

  // путь: от левого края до финишного столба
  const x = 26 + 258 * (done / total);
  const man = card.querySelector('.w-walker');
  const prev = Number(card.dataset.x);
  const moved = !stale && Number.isFinite(prev) && Math.abs(x - prev) > 0.5;

  card.dataset.x = String(x);
  man.style.transform = `translate(${x}px, 104px)`;
  card.classList.toggle('finished', finished);
  card.setAttribute('aria-label',
    `Путь к цели: ${g.name}, ${done} из ${total} шагов${finished ? ', дошёл' : ''}`);

  card.querySelector('.w-goal').innerHTML = `${iconOf(g.icon)} ${escapeHtml(g.name)}`;
  card.querySelector('.w-steps').textContent = finished ? 'Дошёл!' : `${done} / ${total} шагов`;

  // огонёк: серия горит — рвать жалко
  const streak = marathonStreak(g);
  const flame = card.querySelector('.w-flame');
  flame.classList.toggle('cold', streak === 0);
  flame.innerHTML = `${icon('i-flame', 'ic ic-s')}<b>${streak}</b>`;

  // ноги переставляются только пока идёт перемещение, дальше — дышит стоя
  if (moved) {
    card.classList.add('walking');
    clearTimeout(walkerWalkTimer);
    walkerWalkTimer = setTimeout(() => card.classList.remove('walking'), 1150);
  }
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
  const min = isMinOn(h, TODAY);
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

  // кнопка/бейдж минимума
  let minHtml = '';
  if (!off && h.min) {
    if (min) minHtml = `<span class="min-badge">${icon('i-check', 'ic ic-s')} минимум</span>`;
    else if (!done) minHtml = `<button class="min-btn" data-min="${h.id}" title="${escapeHtml(h.min)}">минимум</button>`;
  }

  const card = document.createElement('div');
  card.className = 'habit' + (done ? ' done' : '') + (off ? ' off' : '');
  card.innerHTML = `
    <div class="habit-icon">${iconOf(h.icon)}</div>
    <div class="habit-main" data-edit="${h.id}" role="button" tabindex="0" aria-label="Редактировать: ${escapeHtml(h.name)}">
      <div class="habit-name">${escapeHtml(h.name)}</div>
      <div class="habit-meta">
        <span class="streak ${streak ? '' : 'zero'}">${icon('i-flame')}${streak}</span>
        ${goalText && !off && !min ? `<span class="goal-text">${goalText}</span>` : ''}
        ${off ? `<span class="goal-text">${schedText}</span>` : ''}
        ${stake}
        ${minHtml}
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
  document.querySelectorAll('#screen-today [data-min]').forEach(b =>
    b.addEventListener('click', () => {
      const h = habits.find(x => x.id === b.dataset.min);
      if (!h) return;
      toggleMinMark(h, TODAY);
      render();
      toast('Минимум сделан — серия продолжается 👊');
    }));
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

  const C = 327;
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
    parts.length ? `Штраф сегодня: ${parts.join(' + ')}` : '';
}

/* ---------- ЭКРАН «КАЛЕНДАРЬ» ---------- */
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

  document.getElementById('cal-title').textContent =
    first.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '');

  const now = new Date();
  const isCurrentMonth = y === now.getFullYear() && m === now.getMonth();
  document.getElementById('cal-today-btn').hidden = isCurrentMonth;

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

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
      <div class="cal-stat gold"><b>${lost}₽</b><span>штрафов</span></div>
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
      const min = isMinOn(h, key);
      let control;
      if (h.goal.type === 'count') {
        const val = h.counts?.[key] || 0;
        control = `
          <div class="stepper">
            <button data-step="-1" data-h="${h.id}" aria-label="Меньше">${icon('i-minus', 'ic ic-s')}</button>
            <span class="stp-val ${done ? 'ok' : ''}">${min ? 'мин' : `${val}/${h.goal.target}`}</span>
            <button data-step="1" data-h="${h.id}" aria-label="Больше">${icon('i-plus', 'ic ic-s')}</button>
          </div>`;
      } else {
        control = `
          <button class="habit-check ${done ? '' : ''}" style="width:42px;height:42px" data-dtoggle="${h.id}"
            aria-label="Отметить: ${escapeHtml(h.name)}">${done ? icon('i-check') : ''}</button>`;
      }
      const minBtn = h.min && !done
        ? `<button class="min-btn" data-dmin="${h.id}" title="${escapeHtml(h.min)}">мин</button>` : '';
      const minBadge = min ? `<span class="min-badge">минимум</span>` : '';
      return `
        <div class="day-habit-row ${done ? 'done' : ''}">
          <div class="habit-icon" style="width:42px;height:42px;font-size:19px">${iconOf(h.icon)}</div>
          <div class="ledger-main">
            <div class="ledger-name">${escapeHtml(h.name)}</div>
            <div class="ledger-day">${done ? (min ? 'минимум — серия жива' : 'выполнено') : 'не выполнено'}</div>
          </div>
          ${minBadge}${minBtn}${control}
        </div>`;
    }).join('');
  }

  const charges = ledger.filter(e => e.day === key);
  if (charges.length) {
    html += `<p class="field-label">Штрафы за этот день</p>`;
    html += charges.map(e => `
      <div class="ledger-row">
        <span class="ledger-icon">${iconOf(e.icon)}</span>
        <div class="ledger-main"><div class="ledger-name">${escapeHtml(e.name || '')}</div></div>
        <span class="ledger-amount">${e.mode === 'money'
          ? `−${e.amount}₽` : `${icon('i-lock')} ${(e.apps || []).length}`}</span>
      </div>`).join('');
  }

  if (key < TODAY && scheduled.length) {
    html += `<p class="hint">Отметки задним числом влияют на стрики и календарь.
      Уже зафиксированные штрафы не отменяются.</p>`;
  }

  body.innerHTML = html;

  body.querySelectorAll('[data-dtoggle]').forEach(b =>
    b.addEventListener('click', () => {
      const h = habits.find(x => x.id === b.dataset.dtoggle);
      if (!h) return;
      setDayMark(h, key, { done: h.history[key] === 'min' ? true : !h.history[key] });
      renderDaySheet();
      render();
    }));
  body.querySelectorAll('[data-dmin]').forEach(b =>
    b.addEventListener('click', () => {
      const h = habits.find(x => x.id === b.dataset.dmin);
      if (!h) return;
      toggleMinMark(h, key);
      renderDaySheet();
      render();
    }));
  body.querySelectorAll('[data-step]').forEach(b =>
    b.addEventListener('click', () => {
      const h = habits.find(x => x.id === b.dataset.h);
      if (!h) return;
      if (h.history[key] === 'min') h.history[key] = false;   // счётчик снимает «мин»
      const cur = h.counts?.[key] || 0;
      setDayMark(h, key, { count: cur + Number(b.dataset.step) });
      renderDaySheet();
      render();
    }));
}

/* ---------- ЭКРАН «СТАТИСТИКА» ---------- */

// доля выполнения за неделю, начинающуюся с monday (только прошедшие дни)
function weekCompletion(monday) {
  let sched = 0, done = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const key = dateKey(d);
    if (key > TODAY) break;
    habits.forEach(h => {
      if (h.createdAt > key || !isScheduledOn(h, d)) return;
      sched++;
      if (doneOn(h, key)) done++;
    });
  }
  return sched ? Math.round((done / sched) * 100) : null;
}

function renderWeekChart() {
  const now = new Date();
  const monday = addDays(now, -dayIdx(now));
  const lastMonday = addDays(monday, -7);

  const thisPct = weekCompletion(monday);
  const lastPct = weekCompletion(lastMonday);

  document.getElementById('wc-pct').textContent = (thisPct ?? 0) + '%';
  const deltaEl = document.getElementById('wc-delta');
  if (thisPct !== null && lastPct !== null) {
    const diff = thisPct - lastPct;
    deltaEl.textContent = diff >= 0 ? `+${diff}% к прошлой неделе` : `${diff}% к прошлой неделе`;
    deltaEl.className = 'wc-delta ' + (diff >= 0 ? 'up' : 'downish');
  } else {
    deltaEl.textContent = 'первая неделя — сравнивать пока не с чем';
    deltaEl.className = 'wc-delta downish';
  }

  // бары по дням недели
  const W = 320, H = 120, top = 8, lblH = 16;
  const barW = 26, gap = (W - 7 * barW) / 8;
  let bars = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const key = dateKey(d);
    const x = gap + i * (barW + gap);
    const isFuture = key > TODAY;
    const isToday = key === TODAY;

    let pct = 0;
    if (!isFuture) {
      let sched = 0, done = 0;
      habits.forEach(h => {
        if (h.createdAt > key || !isScheduledOn(h, d)) return;
        sched++;
        if (doneOn(h, key)) done++;
      });
      pct = sched ? done / sched : 0;
    }
    const maxH = H - top - lblH;
    const bh = Math.max(4, Math.round(maxH * pct));
    const y = top + (maxH - bh);

    bars += `<rect class="bar-bg" x="${x}" y="${top}" width="${barW}" height="${maxH}" rx="6"/>`;
    if (!isFuture && pct > 0) {
      bars += `<rect class="bar-fill ${isToday ? '' : 'muted'}" x="${x}" y="${y}" width="${barW}" height="${bh}" rx="6"/>`;
    }
    bars += `<text class="bar-lbl ${isToday ? 'today' : ''}" x="${x + barW / 2}" y="${H - 3}">${DAY_NAMES[i]}</text>`;
  }
  document.getElementById('week-chart-box').innerHTML =
    `<svg class="week-chart" viewBox="0 0 ${W} ${H}" role="img"
       aria-label="Диаграмма выполнения привычек по дням недели">${bars}</svg>`;
}

function renderStats() {
  const curStreak = bestCurrentStreak();
  const bestStreak = habits.length ? Math.max(...habits.map(computeBestStreak)) : 0;
  const totalDone = habits.reduce(
    (s, h) => s + Object.keys(h.history).filter(k => doneOn(h, k)).length, 0);
  const lost = ledger.reduce((s, e) => s + (e.amount || 0), 0);

  document.getElementById('st-current-streak').textContent = curStreak;
  document.getElementById('st-best-streak').textContent = bestStreak;
  document.getElementById('st-total-done').textContent = totalDone;
  document.getElementById('st-lost').textContent = lost + '₽';

  renderWeekChart();
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
  habits.forEach(h => mk(h.id, h.name.length > 14 ? h.name.slice(0, 14) + '…' : h.name));
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
      <span class="ledger-icon">${iconOf(h.icon)}</span>
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
    box.innerHTML = `<p class="hint">Пока пусто — ни одного штрафа. Так держать!</p>`;
    return;
  }
  box.innerHTML = ledger.slice(-30).reverse().map(e => `
    <div class="ledger-row">
      <span class="ledger-icon">${iconOf(e.icon)}</span>
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
function avatarHtml(p) {
  if (p.photo) return `<img src="${p.photo}" alt="" />`;
  if (p.emoji) return escapeHtml(p.emoji);
  const name = (p.name || '').trim();
  return name ? escapeHtml(name[0]) : '?';
}
function applyAvatar(el, p) {
  el.classList.toggle('emoji', !p.photo && !!p.emoji);
  el.style.background = p.photo ? 'transparent' : (p.emoji ? '' : (p.color || COLORS[0]));
  el.innerHTML = avatarHtml(p);
}

function renderProfile() {
  const name = profile.name?.trim();
  document.getElementById('profile-name').textContent = name || 'Без имени';
  applyAvatar(document.getElementById('profile-avatar'), profile);

  const firstDay = habits.length
    ? habits.map(h => h.createdAt).sort()[0]
    : profile.createdAt;
  document.getElementById('profile-since').textContent =
    firstDay ? `в disbit с ${formatDay(firstDay)}` : 'добро пожаловать!';

  renderMedals();

  // мотивация
  const lvl = profile.motivation?.level ?? 50;
  document.getElementById('mot-level').value = lvl;
  document.getElementById('mot-out').textContent = lvl + '%';
  document.getElementById('mot-text').value = profile.motivation?.text || '';

  document.getElementById('set-offday').checked = !!settings.showOffday;

  renderRewards();
  renderFriends();
  renderThemeGrid();
  renderAccount();
}

/* достижения-медали */
function renderMedals() {
  const box = document.getElementById('medal-grid');
  if (!box) return;
  const metrics = {
    streak: habits.length ? Math.max(...habits.map(computeBestStreak)) : 0,
    fines: ledger.filter(e => e.mode === 'money').reduce((s, e) => s + (e.amount || 0), 0),
    locks: ledger.filter(e => e.mode === 'lock').length,
    marathons: goals.filter(g => isMarathon(g) && goalPct(g) >= 100).length,
    steps: totalSteps()
  };
  box.innerHTML = MEDALS.map(m => {
    const cur = metrics[m.kind];
    const earned = cur >= m.at;
    const sub = earned ? 'получена' : `${Math.min(cur, m.at)}/${m.at}`;
    return `
      <div class="medal ${earned ? 'earned ' + m.cls : 'locked'}"
        title="${m.name}${earned ? '' : ' — ещё ' + (m.at - cur)}">
        <span class="m-ic">${icon(m.ic)}</span>
        <span class="m-name">${m.name}</span>
        <span class="m-sub">${sub}</span>
      </div>`;
  }).join('');
}

/* большие цели */
function renderGoals() {
  const box = document.getElementById('goal-list');
  if (!goals.length) {
    box.innerHTML = `<p class="hint" style="margin-bottom:8px">Пока нет больших целей.</p>`;
    return;
  }
  box.innerHTML = goals.map(g => {
    const pct = goalPct(g);
    const deadline = g.deadline ? `до ${formatDay(g.deadline)}` : '';
    // с путником прогресс считается сам из выполненных привычек — крутилки ±5 не нужны
    const walking = g.steps > 0;
    const manual = `
      <button class="mini-btn" data-gminus="${g.id}" aria-label="Минус 5%">−5</button>
      <button class="mini-btn" data-gplus="${g.id}" aria-label="Плюс 5%">+5</button>`;
    const steps = `<span class="goal-text">${Math.min(stepsDone(g), g.steps)} / ${g.steps} шагов</span>`;
    return `
      <div class="goal-row">
        <div class="goal-top">
          <span class="g-icon">${iconOf(g.icon)}</span>
          <span class="g-name">${escapeHtml(g.name)}</span>
          <span class="g-deadline">${deadline}</span>
        </div>
        <div class="goal-bar"><div class="goal-fill" style="width:${pct}%"></div></div>
        <div class="goal-controls">
          <span class="g-pct">${pct}%</span>
          ${walking ? steps : manual}
          <button class="mini-btn" data-gedit="${g.id}">изменить</button>
          <button class="mini-btn danger" data-gdel="${g.id}">удалить</button>
        </div>
      </div>`;
  }).join('');

  box.querySelectorAll('[data-gplus]').forEach(b =>
    b.addEventListener('click', () => bumpGoal(b.dataset.gplus, 5)));
  box.querySelectorAll('[data-gminus]').forEach(b =>
    b.addEventListener('click', () => bumpGoal(b.dataset.gminus, -5)));
  box.querySelectorAll('[data-gedit]').forEach(b =>
    b.addEventListener('click', () => openGoalSheet(b.dataset.gedit)));
  box.querySelectorAll('[data-gdel]').forEach(b =>
    b.addEventListener('click', () => {
      if (!confirm('Удалить цель?')) return;
      goals = goals.filter(g => g.id !== b.dataset.gdel);
      saveJson(GOALS_KEY, goals);
      render();
    }));
}
function bumpGoal(id, delta) {
  const g = goals.find(x => x.id === id);
  if (!g) return;
  const before = g.progress || 0;
  g.progress = Math.max(0, Math.min(100, before + delta));
  saveJson(GOALS_KEY, goals);
  render();
  if (before < 100 && g.progress === 100) {
    toast(`Большая цель достигнута: ${g.name} 🏆`);
  }
}
function openGoalSheet(id = null) {
  editingGoalId = id;
  const g = goals.find(x => x.id === id);
  document.getElementById('goal-sheet-title').textContent = g ? 'Изменить цель' : 'Большая цель';
  document.getElementById('g-name').value = g?.name || '';
  document.getElementById('g-deadline').value = g?.deadline || '';
  document.getElementById('g-steps').value = g?.steps ?? 30;
  buildIconPicker('goal-icon-picker', g?.icon || 'svg:i-h-run');
  buildScenePicker('goal-scene-picker', g?.scene || SCENES[0].id);
  buildMarathonHabits(g);
  openSheet('goal-overlay');
  document.getElementById('g-name').focus();
}

/* Привычки марафона: свои — отмечены, занятые другим марафоном — заблокированы
   (правило «1 привычка = 1 марафон»). Лимит — MARATHON_MAX_HABITS. */
function buildMarathonHabits(g) {
  const box = document.getElementById('goal-habit-list');
  const mine = new Set(g?.habitIds || []);

  if (!habits.length) {
    box.innerHTML = `<p class="hint" style="margin:0">Привычек пока нет — та, что нужна цели, создастся сама.</p>`;
    updateMarathonCount();
    return;
  }

  box.innerHTML = habits.map(h => {
    const taken = habitTakenBy(h.id, g?.id || null);
    const checked = mine.has(h.id);
    return `
      <label class="mh-row ${taken ? 'taken' : ''}">
        <input type="checkbox" class="mh-check" value="${h.id}"
               ${checked ? 'checked' : ''} ${taken ? 'disabled' : ''} />
        <span class="mh-icon">${iconOf(h.icon)}</span>
        <span class="mh-name">${escapeHtml(h.name)}</span>
        ${taken ? `<span class="mh-taken">в марафоне «${escapeHtml(taken.name)}»</span>` : ''}
      </label>`;
  }).join('');

  box.querySelectorAll('.mh-check').forEach(c =>
    c.addEventListener('change', () => {
      if (checkedMarathonHabits().length > MARATHON_MAX_HABITS) {
        c.checked = false;
        toast(`В марафоне не больше ${MARATHON_MAX_HABITS} привычек`);
      }
      updateMarathonCount();
    }));
  updateMarathonCount();
}
function checkedMarathonHabits() {
  return [...document.querySelectorAll('#goal-habit-list .mh-check:checked')].map(c => c.value);
}
function updateMarathonCount() {
  const el = document.getElementById('g-habits-count');
  if (el) el.textContent = `${checkedMarathonHabits().length} / ${MARATHON_MAX_HABITS}`;
}

// привычка «под цель» — создаётся вместе с марафоном, чтобы было что выполнять
function createGoalHabit(name, iconSel) {
  const h = {
    id: 'h' + Date.now(),
    name,
    icon: iconSel,
    color: COLORS[0],
    schedule: [0,1,2,3,4,5,6],
    min: '',
    goal: { type: 'check', target: 1, unit: '' },
    stake: { mode: 'money', amount: 100, recipient: 'charity' },
    createdAt: TODAY,
    counts: {},
    history: {}
  };
  habits.push(h);
  save();
  apiCall('POST', '/habits', h);
  return h;
}

function saveGoal() {
  const name = document.getElementById('g-name').value.trim();
  if (!name) { alert('Опиши цель'); return; }
  const iconSel = document.querySelector('#goal-icon-picker .selected')?.dataset.icon || 'svg:i-h-run';
  const sceneSel = document.querySelector('#goal-scene-picker .selected')?.dataset.scene || SCENES[0].id;
  const deadline = document.getElementById('g-deadline').value || null;
  const steps = Math.max(0, Math.min(999, Number(document.getElementById('g-steps').value) || 0));
  const picked = checkedMarathonHabits();

  if (editingGoalId) {
    const g = goals.find(x => x.id === editingGoalId);
    if (!g) return;
    let ids = picked.slice(0, MARATHON_MAX_HABITS);
    // марафон включили у старой цели — заводим ей привычку, если своих ещё нет
    if (steps > 0 && !ids.length) {
      ids = [createGoalHabit(name, iconSel).id];
    }
    // startedAt ставим один раз: прошлые отметки марафон не «дарит»
    Object.assign(g, {
      name, icon: iconSel, deadline, steps, scene: sceneSel,
      habitIds: steps > 0 ? ids : [],
      startedAt: g.startedAt || (steps > 0 ? TODAY : null)
    });
  } else {
    const g = {
      id: 'g' + Date.now(), name, icon: iconSel, deadline, progress: 0,
      steps, scene: sceneSel, habitIds: [], startedAt: steps > 0 ? TODAY : null
    };
    if (steps > 0) {
      // привычка под саму цель + вручную добавленные, но не больше лимита
      const own = createGoalHabit(name, iconSel);
      g.habitIds = [own.id, ...picked].slice(0, MARATHON_MAX_HABITS);
    }
    goals.push(g);
  }

  saveJson(GOALS_KEY, goals);
  closeSheet('goal-overlay');
  render();
  if (steps > 0 && !editingGoalId) {
    toast(`Марафон запущен: ${name}. Привычка создана — вперёд! 🏃`);
  }
}

/* награды */
function renderRewards() {
  const box = document.getElementById('reward-list');
  const streak = bestCurrentStreak();
  if (!rewards.length) {
    box.innerHTML = `<p class="hint" style="margin-bottom:8px">Например: 7 дней подряд → любимый десерт.</p>`;
    return;
  }
  box.innerHTML = rewards
    .slice()
    .sort((a, b) => a.days - b.days)
    .map(r => {
      const state = r.claimed
        ? `<span class="min-badge">получена</span>`
        : (r.days <= streak
            ? `<span class="min-badge">доступна!</span>`
            : `<span class="goal-text">${streak}/${r.days} дн.</span>`);
      return `
        <div class="ledger-row">
          <span class="ledger-icon">${icon('i-gift', 'ic')}</span>
          <div class="ledger-main">
            <div class="ledger-name">${escapeHtml(r.text)}</div>
            <div class="ledger-day">серия ${r.days} дн.</div>
          </div>
          ${state}
          <button class="mini-btn danger" data-rwdel="${r.id}">✕</button>
        </div>`;
    }).join('');

  box.querySelectorAll('[data-rwdel]').forEach(b =>
    b.addEventListener('click', () => {
      rewards = rewards.filter(r => r.id !== b.dataset.rwdel);
      saveJson(REWARDS_KEY, rewards);
      render();
    }));
}
function saveReward() {
  const days = Math.max(1, Math.min(365, Number(document.getElementById('rw-days').value) || 7));
  const text = document.getElementById('rw-text').value.trim();
  if (!text) { alert('Напиши, чем себя наградишь'); return; }
  rewards.push({ id: 'r' + Date.now(), days, text, claimed: false });
  saveJson(REWARDS_KEY, rewards);
  closeSheet('reward-overlay');
  render();
}

/* друзья */
function renderFriends() {
  const box = document.getElementById('friend-list');
  if (!friends.length) {
    box.innerHTML = `<p class="hint" style="margin-bottom:8px">Добавь друзей — вместе держать дисциплину проще.</p>`;
    return;
  }
  box.innerHTML = friends.map(f => `
    <div class="friend-row">
      <span class="friend-ava">${escapeHtml(f.emoji || '🙂')}</span>
      <span class="friend-name">${escapeHtml(f.name)}</span>
      <button class="mini-btn danger" data-fdel="${f.id}">✕</button>
    </div>`).join('');
  box.querySelectorAll('[data-fdel]').forEach(b =>
    b.addEventListener('click', () => {
      friends = friends.filter(f => f.id !== b.dataset.fdel);
      saveJson(FRIENDS_KEY, friends);
      renderFriends();
    }));
}
function saveFriend() {
  const name = document.getElementById('fr-name').value.trim();
  if (!name) { alert('Введи имя друга'); return; }
  const emoji = document.querySelector('#fr-emoji-grid .selected')?.dataset.emoji || '🙂';
  friends.push({ id: 'f' + Date.now(), name, emoji });
  saveJson(FRIENDS_KEY, friends);
  closeSheet('friend-overlay');
  renderFriends();
}

/* идеи на будущее */
function renderBacklog() {
  const box = document.getElementById('backlog-list');
  if (!backlog.length) {
    box.innerHTML = `<p class="hint" style="margin-bottom:8px">Идеи привычек, до которых дойдут руки позже.</p>`;
    return;
  }
  box.innerHTML = backlog.map(b => `
    <div class="ledger-row">
      <span class="ledger-icon">${iconOf(b.icon)}</span>
      <div class="ledger-main"><div class="ledger-name">${escapeHtml(b.name)}</div></div>
      <button class="mini-btn" data-bstart="${b.id}">начать</button>
      <button class="mini-btn danger" data-bdel="${b.id}">✕</button>
    </div>`).join('');

  box.querySelectorAll('[data-bstart]').forEach(btn =>
    btn.addEventListener('click', () => {
      const idea = backlog.find(x => x.id === btn.dataset.bstart);
      if (!idea) return;
      pendingBacklogId = idea.id;
      openAddSheet();
      document.getElementById('f-name').value = idea.name;
      setPickSelected('icon-picker', 'icon', idea.icon);
    }));
  box.querySelectorAll('[data-bdel]').forEach(btn =>
    btn.addEventListener('click', () => {
      backlog = backlog.filter(x => x.id !== btn.dataset.bdel);
      saveJson(BACKLOG_KEY, backlog);
      renderBacklog();
    }));
}
function saveIdea() {
  const name = document.getElementById('idea-name').value.trim();
  if (!name) { alert('Опиши идею'); return; }
  const iconSel = document.querySelector('#idea-icon-picker .selected')?.dataset.icon || HABIT_ICONS[0];
  backlog.push({ id: 'b' + Date.now(), name, icon: iconSel });
  saveJson(BACKLOG_KEY, backlog);
  closeSheet('idea-overlay');
  renderBacklog();
}

/* темы */
/* ---------- АККАУНТ: UI ---------- */
function renderAccount() {
  const box = document.getElementById('acc-box');
  if (!box) return;
  if (!API) {
    box.innerHTML = `<p class="hint" style="margin:0">Аккаунты и синхронизация работают
      при запуске через сервер disbit (см. backend/README). Открой
      <b>localhost:3000</b> — здесь появятся вход и регистрация.
      Пока всё хранится локально на этом устройстве.</p>`;
    return;
  }
  if (authUser) {
    box.innerHTML = `
      <div class="ledger-row">
        <span class="ledger-icon">${icon('i-check', 'ic')}</span>
        <div class="ledger-main">
          <div class="ledger-name">@${escapeHtml(authUser.login)}</div>
          <div class="ledger-day" style="text-transform:none">${escapeHtml(authUser.email)}</div>
        </div>
        <span class="acc-badge">синхронизация</span>
      </div>
      <button class="row-btn danger" id="btn-logout">
        ${icon('i-x')}<span>Выйти из аккаунта</span>
      </button>`;
    box.querySelector('#btn-logout').addEventListener('click', logout);
  } else {
    box.innerHTML = `
      <p class="hint" style="margin:0 0 10px">Войди, чтобы привычки и штрафы
        синхронизировались с сервером и не потерялись.</p>
      <div class="sheet-actions" style="margin-top:0">
        <button class="btn-ghost" id="btn-open-register">Регистрация</button>
        <button class="btn-primary" id="btn-open-login">Войти</button>
      </div>`;
    box.querySelector('#btn-open-login').addEventListener('click', () => openAuthSheet('login'));
    box.querySelector('#btn-open-register').addEventListener('click', () => openAuthSheet('register'));
  }
}

let authGateActive = false;
const GATE_KEY = 'disbit_gate_v1';

function openAuthSheet(mode) {
  authGateActive = false;
  document.getElementById('auth-cancel').hidden = false;
  document.getElementById('auth-local').hidden = true;
  setAuthMode(mode);
  document.getElementById('auth-error').hidden = true;
  openSheet('auth-overlay');
  document.getElementById(mode === 'login' ? 'li-id' : 'rg-login').focus();
}

// обязательный гейт при входе в приложение
function openAuthGate() {
  authGateActive = true;
  document.getElementById('auth-cancel').hidden = true;      // «Позже» нет
  document.getElementById('auth-local').hidden = !!API;      // локальный режим — только без сервера
  document.getElementById('auth-note').textContent = API
    ? 'Для работы с disbit нужен аккаунт: привычки хранятся на сервере и не потеряются.'
    : 'Сервер недоступен — можно продолжить локально, данные останутся на этом устройстве.';
  setAuthMode('register');
  document.getElementById('auth-error').hidden = true;
  openSheet('auth-overlay');
}
function passGate() {
  authGateActive = false;
  localStorage.setItem(GATE_KEY, '1');
}
function setAuthMode(mode) {
  authMode = mode;
  document.getElementById('auth-title').textContent = mode === 'login' ? 'Вход' : 'Регистрация';
  document.getElementById('auth-submit').textContent = mode === 'login' ? 'Войти' : 'Создать аккаунт';
  document.getElementById('auth-login-form').hidden = mode !== 'login';
  document.getElementById('auth-register-form').hidden = mode !== 'register';
  setSegActive('auth-tabs', 'auth', mode);
}
function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.hidden = false;
}
async function submitAuth() {
  const btn = document.getElementById('auth-submit');
  btn.disabled = true;
  btn.textContent = 'Секунду…';
  try {
    let res;
    if (authMode === 'login') {
      res = await apiCallStrict('POST', '/auth/login', {
        id: document.getElementById('li-id').value.trim(),
        password: document.getElementById('li-pass').value
      });
    } else {
      res = await apiCallStrict('POST', '/auth/register', {
        login: document.getElementById('rg-login').value.trim(),
        email: document.getElementById('rg-email').value.trim(),
        password: document.getElementById('rg-pass').value
      });
    }
    if (res.error) { showAuthError(res.error); return; }

    setAuth(res.token, res.user);
    passGate();
    closeSheet('auth-overlay');
    toast(authMode === 'login'
      ? `С возвращением, ${res.user.login}!`
      : `Аккаунт создан. Привет, ${res.user.login}!`);
    renderAccount();
    apiBootstrap();   // подтянуть/залить данные аккаунта
  } finally {
    btn.disabled = false;
    setAuthMode(authMode);
  }
}
async function logout() {
  await apiCall('POST', '/auth/logout');
  setAuth(null, null);
  renderAccount();
  toast('Вышел из аккаунта. Данные остались на устройстве.');
  if (API) openAuthGate();   // регистрация обязательна — гейт снова
}

/* ---------- ДОК: гауссова магнификация (по dock.tsx) ---------- */
function initDock() {
  const dock = document.getElementById('dock');
  if (!dock) return;
  const fine = window.matchMedia?.('(pointer: fine)')?.matches;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (!fine || reduced) return;   // на тачах и при reduced-motion — без магнификации

  const icons = [...dock.querySelectorAll('.di-icon')];
  const MAG = 1.35, SIGMA = 90;
  let raf = null, pointerX = Infinity;

  const apply = () => {
    raf = null;
    for (const el of icons) {
      const r = el.getBoundingClientRect();
      const d = pointerX === Infinity ? Infinity : Math.abs(pointerX - (r.left + r.width / 2));
      const scale = d === Infinity
        ? 1
        : 1 + (MAG - 1) * Math.exp(-(d * d) / (2 * SIGMA * SIGMA));
      el.style.transform = scale === 1 ? '' : `scale(${scale.toFixed(3)})`;
    }
  };
  dock.addEventListener('pointermove', e => {
    pointerX = e.clientX;
    if (!raf) raf = requestAnimationFrame(apply);
  });
  dock.addEventListener('pointerleave', () => {
    pointerX = Infinity;
    if (!raf) raf = requestAnimationFrame(apply);
  });
}

function applyTheme() {
  const t = THEMES.find(x => x.id === settings.theme) ? settings.theme : 'blue';
  if (t === 'blue') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
function renderThemeGrid() {
  const box = document.getElementById('theme-grid');
  box.innerHTML = '';
  THEMES.forEach(t => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-swatch' + (settings.theme === t.id ? ' active' : '');
    b.style.background = t.c;
    b.setAttribute('aria-label', 'Тема ' + t.id);
    b.addEventListener('click', () => {
      settings.theme = t.id;
      saveJson(SETTINGS_KEY, settings);
      applyTheme();
      renderThemeGrid();
    });
    box.appendChild(b);
  });
}

/* шторка профиля (имя + аватар) */
function openProfileSheet() {
  avaDraft = {
    name: profile.name || '',
    color: profile.color || COLORS[0],
    photo: profile.photo || null,
    emoji: profile.emoji || null
  };
  document.getElementById('pf-name-input').value = avaDraft.name;
  buildColorPicker('pf-color-picker', avaDraft.color);
  buildEmojiGrid('ava-emoji-grid', avaDraft.emoji, em => {
    avaDraft.emoji = em;
    avaDraft.photo = null;
    updateAvaPreview();
  });
  updateAvaPreview();
  openSheet('profile-overlay');
  document.getElementById('pf-name-input').focus();
}
function updateAvaPreview() {
  avaDraft.name = document.getElementById('pf-name-input').value;
  applyAvatar(document.getElementById('ava-preview'), avaDraft);
}
// уменьшаем фото до 256px и сохраняем как JPEG dataURL
function processPhoto(file) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const s = Math.min(img.width, img.height);
    ctx.drawImage(img,
      (img.width - s) / 2, (img.height - s) / 2, s, s,
      0, 0, size, size);
    avaDraft.photo = canvas.toDataURL('image/jpeg', 0.82);
    avaDraft.emoji = null;
    URL.revokeObjectURL(url);
    updateAvaPreview();
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert('Не удалось прочитать изображение');
  };
  img.src = url;
}
function saveProfile() {
  profile.name = document.getElementById('pf-name-input').value.trim();
  const sel = document.querySelector('#pf-color-picker .selected');
  if (sel) profile.color = sel.dataset.color;
  profile.photo = avaDraft.photo;
  profile.emoji = avaDraft.emoji;
  if (!profile.createdAt) profile.createdAt = TODAY;
  try {
    saveJson(PROFILE_KEY, profile);
  } catch {
    profile.photo = null;   // страховка от переполнения localStorage
    saveJson(PROFILE_KEY, profile);
    alert('Фото слишком большое для хранилища — сохранено без фото');
  }
  closeSheet('profile-overlay');
  renderProfile();
}

/* мотивация */
function saveMotivation() {
  profile.motivation = {
    level: Number(document.getElementById('mot-level').value) || 0,
    text: document.getElementById('mot-text').value.trim()
  };
  if (!profile.createdAt) profile.createdAt = TODAY;
  saveJson(PROFILE_KEY, profile);
  toast('Мотивация сохранена ⚡');
}

/* ---------- ЭКСПОРТ / ИМПОРТ / ОЧИСТКА ---------- */
function exportData() {
  const data = {
    app: 'disbit',
    version: 4,
    exportedAt: new Date().toISOString(),
    habits, ledger, profile, settings, friends, goals, rewards, backlog,
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
      ledger  = Array.isArray(data.ledger)  ? data.ledger  : [];
      friends = Array.isArray(data.friends) ? data.friends : [];
      goals   = Array.isArray(data.goals)   ? data.goals   : [];
      rewards = Array.isArray(data.rewards) ? data.rewards : [];
      backlog = Array.isArray(data.backlog) ? data.backlog : [];
      if (data.profile && typeof data.profile === 'object') profile = { ...profile, ...data.profile };
      if (data.settings && typeof data.settings === 'object') settings = { ...settings, ...data.settings };
      if (data.settled) localStorage.setItem(SETTLED_KEY, data.settled);

      save(); saveLedger();
      saveJson(PROFILE_KEY, profile);
      saveJson(SETTINGS_KEY, settings);
      saveJson(FRIENDS_KEY, friends);
      saveJson(GOALS_KEY, goals);
      saveJson(REWARDS_KEY, rewards);
      saveJson(BACKLOG_KEY, backlog);
      applyTheme();
      render();
      toast('Импорт завершён ✔');
    } catch (e) {
      alert('Не удалось импортировать: ' + e.message);
    }
  };
  reader.readAsText(file);
}

function wipeData() {
  if (!confirm('Стереть ВСЕ данные disbit? Это действие необратимо.')) return;
  if (!confirm('Точно? Привычки, история, цели, друзья и журнал штрафов будут удалены.')) return;
  [STORAGE_KEY, LEDGER_KEY, SETTLED_KEY, PROFILE_KEY, SETTINGS_KEY,
   FRIENDS_KEY, GOALS_KEY, REWARDS_KEY, BACKLOG_KEY]
    .forEach(k => localStorage.removeItem(k));
  location.reload();
}

/* ---------- НАВИГАЦИЯ (hash-роутинг) ---------- */
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
  if (id === 'auth-overlay' && authGateActive) return;   // гейт не закрывается
  document.getElementById(id).hidden = true;
  if (id === 'add-overlay') { editingId = null; pendingBacklogId = null; }
  if (id === 'day-overlay') daySheetKey = null;
  if (id === 'goal-overlay') editingGoalId = null;
}
function anyOpenSheet() {
  return [...document.querySelectorAll('.sheet-overlay')].find(o => !o.hidden);
}

/* ---------- ПИКЕРЫ ---------- */
function buildIconPicker(containerId, selectedIcon) {
  const ip = document.getElementById(containerId);
  ip.innerHTML = '';
  HABIT_ICONS.forEach(ic => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pick' + (ic === selectedIcon ? ' selected' : '');
    b.innerHTML = iconOf(ic);
    b.dataset.icon = ic;
    b.setAttribute('aria-label', 'Иконка');
    b.addEventListener('click', () => selectIn(ip, b));
    ip.appendChild(b);
  });
}
// пикер сцен путника: превью неба/земли + название
function buildScenePicker(containerId, selectedScene) {
  const sp = document.getElementById(containerId);
  sp.innerHTML = '';
  SCENES.forEach(sc => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'scene-pick' + (sc.id === selectedScene ? ' selected' : '');
    b.dataset.scene = sc.id;
    b.setAttribute('aria-label', 'Сцена: ' + sc.name);
    b.innerHTML = `
      <span class="sp-art" style="background:linear-gradient(180deg, ${sc.sky[0]}, ${sc.sky[1]} 55%, ${sc.sky[2]})">
        <span class="sp-ground" style="background:${sc.ground}"></span>
      </span>
      <span class="sp-name">${escapeHtml(sc.name)}</span>`;
    b.addEventListener('click', () => selectIn(sp, b));
    sp.appendChild(b);
  });
}
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
function buildEmojiGrid(containerId, selected, onPick) {
  const box = document.getElementById(containerId);
  box.innerHTML = '';
  AVA_EMOJIS.forEach(em => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pick' + (em === selected ? ' selected' : '');
    b.textContent = em;
    b.dataset.emoji = em;
    b.addEventListener('click', () => {
      selectIn(box, b);
      if (onPick) onPick(em);
    });
    box.appendChild(b);
  });
}
function buildPickers() {
  buildIconPicker('icon-picker', HABIT_ICONS[0]);
  buildColorPicker('color-picker', COLORS[0]);
}
function selectIn(container, btn) {
  container.querySelectorAll('.pick').forEach(p => p.classList.remove('selected'));
  btn.classList.add('selected');
}

function updateDaysCount() {
  const el = document.getElementById('days-count');
  if (!el) return;
  const n = selectedDays().length;
  el.textContent = n === 7 ? 'каждый день' : `${n} в неделю`;
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
      updateDaysCount();
    });
    dp.appendChild(b);
  });
  updateDaysCount();
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

/* ---------- ФОРМА ПРИВЫЧКИ ---------- */
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
  document.getElementById('f-min').value = h.min || '';

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
  document.getElementById('f-min').value = '';
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
    min: document.getElementById('f-min').value.trim(),
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
    // идея из бэклога стала привычкой — убираем её из списка
    if (pendingBacklogId) {
      backlog = backlog.filter(x => x.id !== pendingBacklogId);
      saveJson(BACKLOG_KEY, backlog);
      pendingBacklogId = null;
    }
  }

  save();
  closeSheet('add-overlay');
  render();
}

/* ---------- ИТОГ ДНЯ (СИМУЛЯЦИЯ, вручную) ---------- */
/* итог дня по марафонам: сколько шагов сделано сегодня и что стоит на кону.
   Пропуск бьёт не только рублём — путник сегодня не сдвинется с места. */
function marathonSummaryHtml() {
  const running = goals.filter(g => isMarathon(g) && goalPct(g) < 100);
  if (!running.length) return '';

  const rows = running.map(g => {
    const total = g.steps;
    const done = Math.min(stepsDone(g), total);
    const scheduled = marathonHabits(g).filter(isScheduledToday);
    const madeToday = scheduled.filter(isDoneToday).length;
    const pending = scheduled.length - madeToday;
    const streak = marathonStreak(g);

    const status = pending > 0
      ? `<b style="color:var(--danger)">путник стоит: ${pending} ${pending === 1 ? 'привычка' : 'привычки'} не закрыта</b>`
      : `<b style="color:var(--primary)">+${madeToday} ${madeToday === 1 ? 'шаг' : 'шага'} сегодня</b>`;

    return `
      <div class="summary-row">
        <span class="big">${iconOf(g.icon)}</span>
        <div>
          <div>${escapeHtml(g.name)}</div>
          ${status}
          <div class="ledger-day">${done} / ${total} шагов${streak ? ` · серия ${streak} дн.` : ''}</div>
        </div>
      </div>`;
  }).join('');

  return `<h3 class="section-title" style="margin-top:18px">Марафон</h3>${rows}`;
}

function showDaySummary() {
  const todays = habits.filter(isScheduledToday);
  const notDone = todays.filter(h => !isDoneToday(h));
  const body = document.getElementById('summary-body');

  if (habits.length === 0) {
    body.innerHTML = `<div class="summary-ok">Сначала добавь привычки 🌱</div>` + marathonSummaryHtml();
  } else if (notDone.length === 0) {
    body.innerHTML = `<div class="summary-ok">Все привычки выполнены!<br/>Никаких штрафов. 🎉</div>`
      + marathonSummaryHtml();
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
        <div class="label">штраф, если не выполнить до конца дня</div></div>`;
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
    body.innerHTML = html + marathonSummaryHtml();
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
  applyTheme();
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
  initDock();

  // аккаунт: вход/регистрация
  wireSeg('auth-tabs', btn => setAuthMode(btn.dataset.auth));
  document.getElementById('auth-submit').addEventListener('click', submitAuth);
  document.getElementById('auth-cancel').addEventListener('click', () => closeSheet('auth-overlay'));
  document.querySelectorAll('.ff-eye').forEach(b =>
    b.addEventListener('click', () => {
      const inp = document.getElementById(b.dataset.eye);
      inp.type = inp.type === 'password' ? 'text' : 'password';
    }));
  document.getElementById('auth-local').addEventListener('click', () => {
    passGate();
    closeSheet('auth-overlay');
    toast('Локальный режим: данные хранятся на этом устройстве');
  });
  ['li-pass', 'rg-pass'].forEach(id =>
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') submitAuth();
    }));

  // календарь
  document.getElementById('cal-prev').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('cal-next').addEventListener('click', () => shiftMonth(1));
  document.getElementById('cal-today-btn').addEventListener('click', () => {
    calCursor = null;
    renderCalendar();
  });

  // кнопки «Сегодня»
  document.getElementById('btn-add').addEventListener('click', openAddSheet);
  document.getElementById('btn-empty-add').addEventListener('click', openAddSheet);
  document.getElementById('btn-cancel').addEventListener('click', () => closeSheet('add-overlay'));
  document.getElementById('btn-save').addEventListener('click', submitHabit);
  document.getElementById('btn-day-summary').addEventListener('click', showDaySummary);
  document.getElementById('btn-summary').addEventListener('click', showDaySummary);
  document.getElementById('btn-summary-close').addEventListener('click', () => closeSheet('summary-overlay'));
  document.getElementById('btn-settle-close').addEventListener('click', () => closeSheet('settle-overlay'));
  document.getElementById('btn-day-close').addEventListener('click', () => closeSheet('day-overlay'));

  // профиль: аватар/имя
  document.getElementById('btn-profile-edit').addEventListener('click', openProfileSheet);
  document.getElementById('pf-cancel').addEventListener('click', () => closeSheet('profile-overlay'));
  document.getElementById('pf-save').addEventListener('click', saveProfile);
  document.getElementById('pf-name-input').addEventListener('input', updateAvaPreview);
  document.getElementById('btn-photo').addEventListener('click', () =>
    document.getElementById('photo-file').click());
  document.getElementById('photo-file').addEventListener('change', e => {
    if (e.target.files?.[0]) processPhoto(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('btn-photo-remove').addEventListener('click', () => {
    avaDraft.photo = null;
    updateAvaPreview();
  });

  // мотивация
  document.getElementById('mot-level').addEventListener('input', e => {
    document.getElementById('mot-out').textContent = e.target.value + '%';
  });
  document.getElementById('mot-save').addEventListener('click', saveMotivation);

  // цели, награды, друзья, идеи
  document.getElementById('btn-goal-add').addEventListener('click', () => openGoalSheet());
  document.getElementById('g-cancel').addEventListener('click', () => closeSheet('goal-overlay'));
  document.getElementById('g-save').addEventListener('click', saveGoal);

  document.getElementById('btn-reward-add').addEventListener('click', () => {
    document.getElementById('rw-days').value = 7;
    document.getElementById('rw-text').value = '';
    openSheet('reward-overlay');
    document.getElementById('rw-text').focus();
  });
  document.getElementById('rw-cancel').addEventListener('click', () => closeSheet('reward-overlay'));
  document.getElementById('rw-save').addEventListener('click', saveReward);

  document.getElementById('btn-friend-add').addEventListener('click', () => {
    document.getElementById('fr-name').value = '';
    buildEmojiGrid('fr-emoji-grid', AVA_EMOJIS[0]);
    openSheet('friend-overlay');
    document.getElementById('fr-name').focus();
  });
  document.getElementById('fr-cancel').addEventListener('click', () => closeSheet('friend-overlay'));
  document.getElementById('fr-save').addEventListener('click', saveFriend);

  document.getElementById('btn-backlog-add').addEventListener('click', () => {
    document.getElementById('idea-name').value = '';
    buildIconPicker('idea-icon-picker', HABIT_ICONS[0]);
    openSheet('idea-overlay');
    document.getElementById('idea-name').focus();
  });
  document.getElementById('idea-cancel').addEventListener('click', () => closeSheet('idea-overlay'));
  document.getElementById('idea-save').addEventListener('click', saveIdea);

  // настройки и данные
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

  // закрытие шторок
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

  // стартовый экран из URL
  switchScreen(location.hash.slice(1) || 'today', false);

  // автоитог прошедших дней
  const fresh = settlePastDays();
  render();

  // обязательная регистрация при входе:
  // с сервером — всегда, пока нет токена; без сервера — один раз, с локальным режимом
  const needGate = !authToken && (API || !localStorage.getItem(GATE_KEY));
  if (needGate) openAuthGate();
  else if (fresh.length) showSettleModal(fresh);

  apiBootstrap();
}

document.addEventListener('DOMContentLoaded', init);
