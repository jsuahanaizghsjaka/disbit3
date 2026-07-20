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
// Достижения. art — файл 3D-иконки в icons/medals/ (у разных порогов разные
// картинки); нет файла — тихо покажется SVG-запаска (см. medalIconHtml).
const MEDALS = [
  // ДРУЗЬЯ (metric = число добавленных друзей)
  { id: 'fr1', kind: 'friends', at: 1, cls: 'blue', art: 'bubble-1.png',
    name: 'Дуэт', desc: 'Первый друг в команде. Вместе держать дисциплину проще.' },
  { id: 'fr5', kind: 'friends', at: 5, cls: 'blue', art: 'bubble-2.png',
    name: 'Полный сквад', desc: 'Пятеро в отряде. Теперь вас так просто не сбить.' },

  // СЕРИЯ ОГОНЬКА (metric = лучшая серия среди привычек)
  { id: 's100', kind: 'streak', at: 100, cls: 'gold', art: 'fire-100.png',
    name: 'Век Дисциплины', desc: '100 дней подряд. Привычка стала частью тебя.' },
  { id: 's250', kind: 'streak', at: 250, cls: 'gold', art: 'fire-100.png',
    name: 'Железный Рубеж', desc: '250 дней. Дисциплина закалилась до железа.' },
  { id: 's500', kind: 'streak', at: 500, cls: 'gold', art: 'fire-500.png',
    name: 'Адепт Постоянства', desc: '500 дней без сдачи. Ты мастер постоянства.' },
  { id: 's750', kind: 'streak', at: 750, cls: 'gold', art: 'fire-500.png',
    name: 'Титан Воли', desc: '750 дней. Волю титана уже ничем не сбить.' },
  { id: 's1000', kind: 'streak', at: 1000, cls: 'gold', art: 'fire-500.png',
    name: 'Тысячелетний Хранитель', desc: '1000 дней без пропусков. Абсолютный статус Легенды.' },

  // МАРАФОНЫ (metric = число доведённых до финиша)
  { id: 'm1', kind: 'marathons', at: 1, cls: 'gold', art: 'trophy-1.png',
    name: 'Первый финиш', desc: 'Первый марафон пройден. Ты доказал себе, что можешь доходить до конца.' },
  { id: 'm3', kind: 'marathons', at: 3, cls: 'gold', art: 'trophy-3.png',
    name: 'Хет-трик', desc: 'Три из трёх! Марафонец, который не останавливается.' },

  // БЛОКИРОВКИ ТЕЛЕФОНА (metric = число блокировок-штрафов)
  { id: 'l10', kind: 'locks', at: 10, cls: 'violet', art: 'lock.png',
    name: 'Быстрый фокус', desc: 'Зашёл, отметил привычку, заблокировал. Никаких отвлечений.' },
  { id: 'l25', kind: 'locks', at: 25, cls: 'violet', art: 'lock.png',
    name: 'Без лишних слов', desc: 'Ты не тратишь время на лишний скроллинг. Сделал дело — экран погас.' },
  { id: 'l50', kind: 'locks', at: 50, cls: 'violet', art: 'lock.png',
    name: 'Режим ниндзя', desc: '50 быстрых заходов. Быстро, чётко, эффективно.' },

  // ШТРАФЫ ДЕНЬГАМИ (metric = ЧИСЛО денежных штрафов, не сумма)
  { id: 'f10', kind: 'fines', at: 10, cls: 'red', art: 'wallet.png',
    name: 'Щедрый вклад', desc: '10 штрафов превратились в реальную помощь. Ошибки тоже могут приносить пользу!' },
  { id: 'f15', kind: 'fines', at: 15, cls: 'red', art: 'wallet.png',
    name: 'Покровитель добра', desc: 'Твои промахи заставляют мир крутиться чуть лучше.' },
  { id: 'f25', kind: 'fines', at: 25, cls: 'red', art: 'cash.png',
    name: 'Меценат месяца', desc: '25 отчислений на добрые дела. Кармический баланс перевешивает в плюс!' },
  { id: 'f40', kind: 'fines', at: 40, cls: 'red', art: 'cash.png',
    name: 'Ангел-хранитель', desc: 'Весомый вклад и в благотворительность, и в развитие проекта.' },
  { id: 'f50', kind: 'fines', at: 50, cls: 'red', art: 'coin.png',
    name: 'Главный благотворитель', desc: '50 добрых дел вместо самобичевания. Ты превратил ошибки в суперсилу!' }
];
// SVG-запаска по виду достижения, если картинка не загрузилась
const MEDAL_FALLBACK = { friends: 'i-users', streak: 'i-flame', marathons: 'i-award', locks: 'i-lock', fines: 'i-coins' };
const COLORS = ['#5B8DFF','#4ADE80','#38BDF8','#F472B6','#A78BFA','#F87171','#FBBF24','#E8722A'];
const AVA_EMOJIS = ['😀','😎','🦊','🐻','🐼','🦁','🐯','🐸','🦉','🐨','🦄','🐢','🚀','🔥','⚡','🌟','🍀','🌊','🎧','🎮','🏔️','🌙','🍕','☕'];
const DAY_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
// вкладка «Статистика» уехала в карточку привычки, её слот занял экран друзей;
// общая статистика осталась отдельным экраном — вход из профиля
const SCREENS = ['today','calendar','friends','stats','medals','profile'];

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
  h.weekTarget = Math.max(0, Math.min(7, Number(h.weekTarget) || 0));  // 0 = строго по дням
  h.pinned = !!h.pinned;                                               // закреплена наверху
  h.history = h.history || {};
  h.counts  = h.counts  || {};
}

/* ---------- АНИМИРОВАННЫЙ СЧЁТЧИК ----------
   Порт AnimateCount (motion/react) на ванильный CSS: основное приложение без
   React, поэтому эффект собран на CSS-анимациях с теми же параметрами —
   450 мс, cubic-bezier(0.23,0.88,0.26,0.92), blur 2px, уход вверх / приход снизу. */
const AC_MS = 450;
function animateCount(el, value) {
  if (!el) return;
  const next = String(value);
  const prev = el.dataset.acValue;
  el.dataset.acValue = next;
  const still = `<span class="ac-item">${escapeHtml(next)}</span>`;
  if (prev === undefined || prev === next) { el.innerHTML = still; return; }

  el.innerHTML =
    `<span class="ac-item ac-out" aria-hidden="true">${escapeHtml(prev)}</span>` +
    `<span class="ac-item ac-in">${escapeHtml(next)}</span>`;
  clearTimeout(el._acTimer);
  // после анимации оставляем одно число, чтобы не копить узлы
  el._acTimer = setTimeout(() => {
    if (el.dataset.acValue === next) el.innerHTML = still;
  }, AC_MS + 60);
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
/* ---------- ГИБКИЙ РЕЖИМ: N дней в неделю ----------
   Для тех, кто не может делать день в день. Конкретные дни недели тогда не
   важны — важно набрать норму за неделю.
   Два разных вопроса, поэтому две функции:
   • isScheduledOn — ПОКАЗЫВАТЬ ли привычку в этот день (пока норма не закрыта);
   • isRequiredOn  — СПРАШИВАТЬ ли за неё (штраф/разрыв серии). Обязательным
     день становится, только когда запаса не осталось: до конца недели ровно
     столько дней, сколько ещё нужно сделать. Пропуск «с запасом» не наказывается. */
function isFlexible(h) { return Number(h.weekTarget) > 0; }
function weekStartOf(d) { return addDays(d, -dayIdx(d)); }

// сколько выполнено на неделе дня d, СТРОГО до самого d
function doneInWeekBefore(h, d) {
  const start = weekStartOf(d);
  const stop = dateKey(d);
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const key = dateKey(addDays(start, i));
    if (key >= stop) break;
    if (doneOn(h, key)) n++;
  }
  return n;
}

function isScheduledOn(h, d) {
  if (isFlexible(h)) return doneInWeekBefore(h, d) < Number(h.weekTarget);
  return h.schedule.includes(dayIdx(d));
}
function isRequiredOn(h, d) {
  if (!isFlexible(h)) return h.schedule.includes(dayIdx(d));
  const need = Number(h.weekTarget) - doneInWeekBefore(h, d);
  if (need <= 0) return false;
  const daysLeft = 7 - dayIdx(d);        // включая сам день d
  return need >= daysLeft;               // запаса нет — сегодня обязателен
}
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
    if (isFlexible(h)) {
      // гибкая: отметка в любой день продолжает серию, а рвёт её только пропуск
      // дня, который был обязателен (запас кончился). День «с запасом» нейтрален.
      if (doneOn(h, key)) { streak++; misses = 0; }
      else if (isRequiredOn(h, d)) { misses++; if (misses >= 2) break; }
    } else if (isScheduledOn(h, d)) {
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
    const counts = isFlexible(h) ? (doneOn(h, key) || isRequiredOn(h, d)) : isScheduledOn(h, d);
    if (counts) {
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
      // штраф только за ОБЯЗАТЕЛЬНЫЙ день: у гибкой привычки пропуск,
      // пока норму недели ещё можно добрать, наказывать не за что
      if (!isRequiredOn(h, d)) return;
      if (doneOn(h, key)) return;
      fresh.push({
        day: key,
        habitId: h.id,
        name: h.name,
        icon: h.icon,
        mode: h.stake.mode,
        amount: h.stake.mode === 'money' ? Number(h.stake.amount || 0) : 0,
        recipient: h.stake.recipient || null,
        apps: h.stake.mode === 'lock' ? (h.stake.apps || []) : [],
        minutes: h.stake.mode === 'lock' ? (h.stake.minutes || LOCK_MINUTES_DEFAULT) : 0
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
    const maxLock = Math.max(...entries.map(e => Number(e.minutes) || 0));
    html += `<div class="summary-row"><span class="big lock">${icon('i-lock')}</span>
      <div><div>Заблокировались бы${maxLock ? ' на ' + formatLock(maxLock) : ''}</div>
      <b>${[...apps].map(escapeHtml).join(', ')}</b></div></div>`;
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
/* КОНТРАКТ СЦЕНЫ — по нему добавляются остальные фоны (марафон, джунгли,
   заплыв, Луна, гора, Антарктика), чтобы они были одной системой, а не
   набором разных картинок:
   • sky[3] — градиент неба сверху вниз, приглушённый. Сцена НЕ должна спорить
     с акцентным цветом интерфейса: яркий цвет в приложении один — акцент
     действий, а фон марафона живёт на приглушённых тонах.
   • far / mid — два слоя рельефа: дальний темнее и холоднее, ближний светлее.
     Глубина делается контрастом слоёв, а не яркостью.
   • ground — полоса земли на y=104, по ней идёт путник. Всегда самый светлый
     из слоёв рельефа: фигурка должна читаться на нём при любом размере.
   • sun — одно тёплое пятно света (или луна/солнце сцены). Один яркий объект.
   • env — тип рельефа: 'dunes' | 'waves' | 'craters' | 'peaks' | 'jungle' | 'snow'.
     Он задаёт форму двух слоёв и землю; путник всегда идёт по нижней полосе.
   • decor — необязательный небесный слой: 'stars' (Луна), 'snowfall' (метель),
     'canopy' (кроны джунглей). Дёшево и плавно, без тяжёлого blur.
   • gear — экипировка фигурки: 'hat' | 'goggles' | 'helmet' | 'cane' | 'axe' | 'hood'.
   • motion — КАК путник движется (задаёт и путь, и позу):
       'walk'   — идёт по земле слева направо (пустыня, Луна, джунгли);
       'trudge' — идёт согнувшись, тяжело, против метели (Антарктида);
       'swim'   — плывёт по воде к берегу справа, тело горизонтально (океан);
       'climb'  — лезет вертикально вверх по стене к вершине (Эверест).
   • finish — как встречаем финиш:
       'ribbon' — финишная лента/берег (устал, отдышался, радуется);
       'flag'   — водружает флаг на вершине/поверхности (Луна, Эверест) + салют. */
const SCENES = [
  {
    id: 'desert',
    name: 'Пустыня',
    finish: 'ribbon', env: 'dunes', gear: 'hat', motion: 'walk',
    sky: ['#16203A', '#43354F', '#8E6A55'],        // приглушённые сумерки — не режет глаза
    sun: '#D99A57', far: '#33304A', mid: '#4B4057', ground: '#6A5443'
  },
  {
    id: 'ocean',
    name: 'Океан',
    finish: 'shore', env: 'waves', gear: 'goggles', motion: 'swim',
    sky: ['#122A3A', '#1C4A55', '#2E7A74'],        // рассветное море
    // water — вся нижняя часть сцены (по ней плывут), ground — ТОЛЬКО песок справа.
    // Раньше низ был залит песком, и казалось, что пловец ползёт по земле.
    sun: '#8FD6C4', far: '#12414E', mid: '#2A8794', water: '#1C6675', ground: '#D8C79B'
  },
  {
    id: 'moon',
    name: 'Луна',
    finish: 'flag', env: 'craters', gear: 'helmet', decor: 'stars', motion: 'walk',
    sky: ['#05070F', '#0B1024', '#161B36'],        // космос: почти чёрное небо
    sun: '#5C79C4', far: '#2A2E44', mid: '#3A3F5A', ground: '#8A8FA6'  // серый реголит
  },
  {
    id: 'everest',
    name: 'Эверест',
    finish: 'summit', env: 'cliff', gear: 'axe', motion: 'climb', ink: '#2B3550',
    sky: ['#1A2C4A', '#39557E', '#8FB4D6'],        // высокогорное небо
    sun: '#EAD8B0', far: '#4A5F82', mid: '#7089A8', ground: '#E4ECF5'  // снежный гребень
  },
  {
    id: 'jungle',
    name: 'Джунгли',
    finish: 'ribbon', env: 'jungle', gear: 'cane', decor: 'canopy', motion: 'walk',
    noSun: true,                                   // в чаще солнца не видно
    sky: ['#16281C', '#274A30', '#4C7A45'],        // влажная зелень
    sun: '#C7E39A', far: '#22452A', mid: '#31603A', ground: '#5A6B3A'
  },
  {
    id: 'antarctica',
    name: 'Антарктида',
    finish: 'ribbon', env: 'snow', gear: 'hood', decor: 'blizzard', motion: 'trudge', ink: '#2B3550',
    sky: ['#243447', '#3E5A6E', '#7C99A8'],        // блёклая метель
    sun: '#D6E4EC', far: '#5A7385', mid: '#8AA3B0', ground: '#DCE7EC'
  }
];
// путь путника по прогрессу t∈[0,1] → {x,y}: у каждой механики свой маршрут
function walkerPath(sc, t) {
  switch (sc.motion) {
    case 'swim': {
      // плывёт по воде; у самого берега (t>0.82) выходит из воды вверх на песок
      if (t < 0.82) return { x: 22 + 258 * t, y: 112 };
      const k = (t - 0.82) / 0.18;
      return { x: 234 + 42 * k, y: 112 - 15 * k };
    }
    case 'climb': return { x: 232, y: 104 - 58 * t };   // лезет вертикально вверх к вершине
    default:      return { x: 26 + 246 * t, y: 104 };   // идёт по земле (walk/trudge)
  }
}
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

// фигурка путника: у каждой механики движения СВОЯ поза, а не просто разный
// головной убор. Кости внутри .w-body переиспользуют классы w-arm/w-leg, чтобы
// одна и та же анимация «шага» (класс .walking) знала, как двигать конечности
// для конкретной позы (см. CSS: .pose-walk/.pose-swim/.pose-climb/.pose-trudge).
function walkerFigure(sc) {
  switch (sc.motion) {
    case 'swim':   return swimFigure(sc);
    case 'climb':  return climbFigure(sc);
    case 'trudge': return trudgeFigure(sc);
    default:       return walkFigure(sc);
  }
}

// идёт прямо: пустыня (шляпа), Луна (шлем), джунгли (трость)
function walkFigure(sc) {
  const g = sc.gear;
  const helmet = g === 'helmet';
  const head = helmet
    ? `<circle class="w-helmet" cx="0" cy="-25" r="6" />
       <path class="w-visor" d="M-3.5,-26.5 L3.5,-26.5" />`
    : `<circle class="w-head" cx="0" cy="-25" r="4.6" />`;
  const gearTop =
    g === 'hat'     ? `<path class="w-gear" d="M-7,-27 L7,-27 M-4.5,-27 Q0,-33 4.5,-27" />` :
    g === 'goggles' ? `<path class="w-gear" d="M-4.4,-25.8 L4.4,-25.8" />` : '';
  const cane = g === 'cane' ? `<path class="w-cane" d="M6,-13 L9,0" />` : '';
  return `
    <g class="w-man pose-walk">
      <g class="w-body">
        ${head}${gearTop}
        <path class="w-pack" d="M-2,-20 L-6,-20 L-6,-13 L-2,-13 Z" />
        <path class="w-torso" d="M0,-20 L0,-10" />
        <path class="w-arm w-arm-b" d="M0,-18 L-5,-12" />
        <path class="w-arm w-arm-f" d="M0,-18 L5,-12" />
        ${cane}
        <path class="w-leg w-leg-b" d="M0,-10 L-4,0" />
        <path class="w-leg w-leg-f" d="M0,-10 L4,0" />
      </g>
    </g>`;
}

// плывёт: тело горизонтально у поверхности воды, гребёт руками, бьёт ногами
function swimFigure(sc) {
  return `
    <g class="w-man pose-swim">
      <g class="w-body">
        <path class="w-torso" d="M-9,0 L5,-1" />
        <circle class="w-head" cx="8" cy="-2" r="3.6" />
        <path class="w-gear" d="M6,-3.4 L10.5,-3.6" />
        <path class="w-arm w-arm-f" d="M2,-1 L10,-6" />
        <path class="w-arm w-arm-b" d="M-3,-1 L-9,-5" />
        <path class="w-leg w-leg-f" d="M-9,0 L-16,-2" />
        <path class="w-leg w-leg-b" d="M-9,0 L-16,3" />
      </g>
    </g>`;
}

// лезет вертикально вверх по стене: тянется руками, упирается ногами, ледоруб
function climbFigure(sc) {
  return `
    <g class="w-man pose-climb">
      <g class="w-body">
        <path class="w-pack" d="M-4,-19 L-8,-18 L-7,-11 L-3,-12 Z" />
        <circle class="w-head" cx="0" cy="-22" r="4" />
        <path class="w-gear-fill" d="M-4,-23 Q0,-29 4,-23 Z" />
        <path class="w-torso" d="M0,-19 L0,-6" />
        <path class="w-arm w-arm-b" d="M0,-17 L-6,-24" />
        <path class="w-arm w-arm-f" d="M0,-17 L7,-25" />
        <path class="w-axe" d="M7,-25 L9,-31 M6.5,-30.5 L11,-31.5" />
        <path class="w-leg w-leg-b" d="M0,-6 L-5,0" />
        <path class="w-leg w-leg-f" d="M0,-6 L6,-1" />
      </g>
    </g>`;
}

// бредёт согнувшись под тяжестью и ветром: голова и торс уведены вперёд,
// рюкзак-груз на спине, шаг тяжёлый (лень баке в геометрию — надёжнее CSS-поворота)
function trudgeFigure(sc) {
  return `
    <g class="w-man pose-trudge">
      <g class="w-body">
        <path class="w-pack" d="M-3,-19 L-8,-17 L-7,-10 L-2,-12 Z" />
        <circle class="w-head" cx="4" cy="-22" r="4.4" />
        <path class="w-gear-fill" d="M-0.5,-22 Q-1,-31 5,-30 Q10,-29 8,-22 Q5,-24 3,-23 Q1,-23 -0.5,-22 Z" />
        <path class="w-torso" d="M3,-21 L-2,-9" />
        <path class="w-arm w-arm-b" d="M1,-17 L-4,-12" />
        <path class="w-arm w-arm-f" d="M1,-17 L5,-11" />
        <path class="w-leg w-leg-b" d="M-2,-9 L-6,0" />
        <path class="w-leg w-leg-f" d="M-2,-9 L3,0" />
      </g>
    </g>`;
}

// финиш сцены: лента (доплыл/дошёл), флаг (Луна, Эверест) или пьедестал.
// Флаг «водружается» на финише — полотнище разворачивается по классу .finished.
function walkerFinish(sc) {
  // ВСЕ координаты финиша держим в пределах x≤299, y≥16: SVG рисуется с
  // preserveAspectRatio="slice", и на узких мобильных карточках видимая зона
  // по X сужается примерно до [20,300] — всё, что правее, обрезается.
  if (sc.finish === 'summit') {
    // флаг на вершине, куда лезет альпинист (путь climb приходит к x≈232,y≈46)
    return `
      <g class="w-finish w-finish-flag">
        <path class="w-pole" d="M240,48 L240,24" />
        <path class="w-cloth" d="M240,24 L253,28 L240,32 Z" />
      </g>`;
  }
  if (sc.finish === 'flag') {
    return `
      <g class="w-finish w-finish-flag">
        <path class="w-pole" d="M286,104 L286,80" />
        <path class="w-cloth" d="M286,80 L299,84 L286,88 Z" />
      </g>`;
  }
  if (sc.finish === 'shore') {
    // берег — это и есть финиш: флажок на песке правее точки выхода из воды (276,97)
    return `
      <g class="w-finish">
        <path class="w-post" d="M292,104 L292,86" />
        <path class="w-flag" d="M292,86 L299,88.5 L292,91 Z" />
      </g>`;
  }
  return `
    <g class="w-finish">
      <path class="w-post" d="M282,104 L282,78" />
      <path class="w-ribbon" d="M282,84 L298,84" />
      <path class="w-flag" d="M282,78 L292,81 L282,84 Z" />
    </g>`;
}

// рельеф сцены: два слоя (дальний/ближний) + земля, форма зависит от env.
// путник всегда идёт по нижней полосе (земля начинается на y=104).
function walkerTerrain(sc) {
  const { far, mid, ground, env } = sc;
  const groundRect = `<rect y="104" width="320" height="28" fill="${ground}" />`;
  switch (env) {
    case 'waves': {   // океан: вся сцена — ВОДА, песок только справа = берег-финиш
      const water = sc.water || mid;
      return `
        <path fill="${far}" d="M0,92 Q40,86 80,91 T160,91 T240,91 T320,91 L320,132 L0,132 Z"/>
        <rect y="99" width="320" height="33" fill="${water}"/>
        <path fill="${mid}" opacity="0.55" d="M0,107 Q40,101 80,106 T160,106 T240,106 T320,106 L320,132 L0,132 Z"/>
        <!-- берег: только правая часть, к нему и плывёт -->
        <path fill="${ground}" d="M236,132 L236,107 Q274,96 320,101 L320,132 Z"/>
        <g class="w-waves">
          <path d="M22,113 q6,-3 12,0 t12,0"/><path d="M112,119 q6,-3 12,0 t12,0"/>
          <path d="M56,125 q6,-3 12,0 t12,0"/><path d="M166,115 q6,-3 12,0 t12,0"/>
          <path d="M86,105 q6,-3 12,0 t12,0"/><path d="M188,127 q6,-3 12,0 t12,0"/>
        </g>`;
    }
    case 'craters':    // Луна: серый реголит + кратеры-эллипсы
      return `
        <path fill="${far}" d="M0,98 Q80,90 160,97 Q240,104 320,96 L320,132 L0,132 Z"/>
        <path fill="${mid}" d="M0,106 Q80,100 160,105 Q240,110 320,104 L320,132 L0,132 Z"/>
        ${groundRect}
        <g fill="rgba(0,0,0,0.16)">
          <ellipse cx="64" cy="118" rx="13" ry="3.6"/><ellipse cx="150" cy="124" rx="9" ry="2.6"/>
          <ellipse cx="214" cy="115" rx="15" ry="4"/><ellipse cx="108" cy="112" rx="6" ry="2"/>
        </g>`;
    case 'cliff':      // Эверест: ОГРОМНЫЙ массив во всю карточку, лезут по его стене
      return `
        ${groundRect}
        <!-- дальний хребет: крупные пики на всю ширину -->
        <path fill="${far}" d="M0,132 L0,84 L38,34 L76,80 L118,26 L166,84 L206,44 L258,86 L300,30 L320,64 L320,132 Z"/>
        <!-- главная гора: вершина (232,44), склоны уходят за края карточки -->
        <path fill="${mid}" d="M40,132 L104,92 L162,58 L200,34 L232,20 L268,48 L300,84 L320,104 L320,132 Z"/>
        <!-- ледяная вертикаль — маршрут восхождения (x≈232), светлее массива -->
        <path fill="rgba(255,255,255,0.16)" d="M212,132 L212,50 L232,26 L252,52 L252,132 Z"/>
        <g stroke="rgba(255,255,255,0.28)" stroke-width="1" fill="none">
          <path d="M222,126 L225,96 L221,64"/><path d="M243,128 L240,98 L245,66"/>
        </g>`;
    case 'jungle':     // джунгли: густая чаща — стволы, кроны, листья, лианы, без пустот
      return `
        <path fill="${far}" d="M0,86 Q50,68 100,84 Q160,100 220,82 Q280,66 320,84 L320,132 L0,132 Z"/>
        <path fill="${mid}" d="M0,104 Q60,92 120,102 Q190,112 250,98 Q290,90 320,100 L320,132 L0,132 Z"/>
        ${groundRect}
        <!-- дальний ярус крон: закрывает верх, чтобы не было пустого неба -->
        <g fill="${far}" opacity="0.95">
          <ellipse cx="20" cy="26" rx="42" ry="22"/><ellipse cx="96" cy="14" rx="46" ry="20"/>
          <ellipse cx="176" cy="22" rx="44" ry="21"/><ellipse cx="252" cy="12" rx="42" ry="19"/>
          <ellipse cx="312" cy="26" rx="40" ry="22"/>
        </g>
        <!-- стволы деревьев: слева, справа и в глубине -->
        <g stroke="${mid}" stroke-width="5" stroke-linecap="round" fill="none">
          <path d="M24,104 L22,46"/><path d="M304,104 L306,44"/><path d="M62,104 L60,66"/>
          <path d="M268,104 L270,62"/><path d="M124,102 L123,74"/><path d="M196,102 L197,72"/>
        </g>
        <!-- кроны на стволах и крупные листья у земли -->
        <g fill="${mid}">
          <ellipse cx="22" cy="46" rx="24" ry="14"/><ellipse cx="306" cy="44" rx="26" ry="15"/>
          <ellipse cx="60" cy="64" rx="17" ry="10"/><ellipse cx="270" cy="60" rx="18" ry="10"/>
          <ellipse cx="123" cy="72" rx="14" ry="8"/><ellipse cx="197" cy="70" rx="15" ry="8"/>
          <path d="M12,104 q-9,-17 4,-28 q8,13 -4,28 Z"/>
          <path d="M294,104 q11,-19 -3,-30 q-10,13 3,30 Z"/>
          <path d="M84,104 q-8,-14 3,-23 q7,11 -3,23 Z"/>
          <path d="M232,104 q9,-15 -3,-24 q-8,11 3,24 Z"/>
        </g>
        <!-- свисающие лианы по всей ширине -->
        <g stroke="${sc.sun}" stroke-width="1.4" fill="none" opacity="0.55" class="w-lianas">
          <path d="M44,0 q5,22 -2,42"/><path d="M96,0 q4,24 -2,46"/><path d="M148,0 q-4,26 3,50"/>
          <path d="M210,0 q4,20 -3,40"/><path d="M258,0 q-3,24 4,44"/><path d="M292,0 q4,18 -2,36"/>
        </g>`;
    case 'snow':       // Антарктида: пологие снежные наносы
      return `
        <path fill="${far}" d="M0,100 Q80,92 160,99 Q240,106 320,98 L320,132 L0,132 Z"/>
        <path fill="${mid}" d="M0,108 Q80,102 160,107 Q240,112 320,106 L320,132 L0,132 Z"/>
        ${groundRect}`;
    default:           // dunes — пустыня
      return `
        <path fill="${far}" d="M0,92 Q46,74 92,90 Q140,104 190,86 Q244,68 320,88 L320,132 L0,132 Z"/>
        <path fill="${mid}" d="M0,106 Q60,92 118,104 Q182,116 240,100 Q286,88 320,102 L320,132 L0,132 Z"/>
        ${groundRect}`;
  }
}

// небо сцены: диск света + необязательный декор (звёзды/метель/кроны)
function walkerSky(sc) {
  // в густой чаще солнца не видно — сцена может его отключить
  const disc = sc.noSun ? '' : `<circle class="w-sun" cx="246" cy="60" r="13" fill="${sc.sun}"/>`;
  let decor = '';
  if (sc.decor === 'stars') {
    decor = `<g class="w-stars" fill="#DCE6FF">
      <circle cx="40" cy="26" r="1"/><circle cx="88" cy="48" r="1.3"/><circle cx="150" cy="22" r="1"/>
      <circle cx="200" cy="42" r="1.1"/><circle cx="284" cy="30" r="1.2"/><circle cx="120" cy="58" r="1"/>
      <circle cx="256" cy="18" r="1"/></g>`;
  } else if (sc.decor === 'snowfall') {
    decor = `<g class="w-snow" fill="rgba(255,255,255,0.72)">
      <circle cx="30" cy="18" r="1.5"/><circle cx="92" cy="10" r="1.2"/><circle cx="152" cy="24" r="1.6"/>
      <circle cx="212" cy="14" r="1.3"/><circle cx="270" cy="22" r="1.5"/><circle cx="118" cy="40" r="1.2"/>
      <circle cx="238" cy="46" r="1.4"/></g>`;
  } else if (sc.decor === 'canopy') {
    decor = `<path class="w-canopy" fill="${sc.far}"
      d="M0,0 h320 v10 q-16,11 -32,0 q-16,-11 -32,0 q-16,11 -32,0 q-16,-11 -32,0
         q-16,11 -32,0 q-16,-11 -32,0 q-16,11 -32,0 q-16,-11 -32,0 q-16,11 -32,0 q-16,-11 -32,0 Z"/>`;
  } else if (sc.decor === 'blizzard') {
    // метель: много косого снега + штрихи ветра, снег летит через всю сцену
    decor = `
      <g class="w-blizz-wind" stroke="rgba(255,255,255,0.28)" stroke-width="1.4" fill="none" stroke-linecap="round">
        <path d="M40,40 h34"/><path d="M120,64 h44"/><path d="M210,34 h38"/><path d="M170,86 h40"/><path d="M70,100 h30"/>
      </g>
      <g class="w-blizz" fill="rgba(255,255,255,0.85)">
        <circle cx="30" cy="16" r="1.5"/><circle cx="90" cy="8" r="1.3"/><circle cx="150" cy="20" r="1.6"/>
        <circle cx="210" cy="12" r="1.4"/><circle cx="266" cy="18" r="1.5"/><circle cx="60" cy="40" r="1.3"/>
        <circle cx="120" cy="34" r="1.5"/><circle cx="190" cy="46" r="1.4"/><circle cx="250" cy="50" r="1.5"/>
        <circle cx="24" cy="70" r="1.4"/><circle cx="160" cy="72" r="1.3"/><circle cx="288" cy="78" r="1.5"/>
      </g>`;
  }
  return disc + decor;
}

// передний план — рисуется ПОВЕРХ путника. Для Антарктиды это пелена метели
// и ближний снег: человека должно быть еле видно сквозь пургу.
function walkerForeground(sc) {
  if (sc.decor !== 'blizzard') return '';
  return `
    <rect class="w-haze" width="320" height="132" fill="rgba(222,236,244,0.34)"/>
    <g class="w-blizz w-blizz-front" fill="rgba(255,255,255,0.95)">
      <circle cx="18" cy="30" r="2"/><circle cx="74" cy="14" r="1.8"/><circle cx="132" cy="36" r="2.1"/>
      <circle cx="188" cy="18" r="1.9"/><circle cx="244" cy="34" r="2"/><circle cx="298" cy="20" r="1.8"/>
      <circle cx="46" cy="62" r="2.1"/><circle cx="104" cy="78" r="1.9"/><circle cx="162" cy="60" r="2"/>
      <circle cx="220" cy="82" r="2.1"/><circle cx="276" cy="66" r="1.9"/><circle cx="10" cy="96" r="2"/>
      <circle cx="140" cy="104" r="2.1"/><circle cx="256" cy="100" r="1.9"/>
    </g>`;
}

// сцену строим ОДИН раз и дальше только двигаем путника: если пересоздавать
// разметку на каждый render(), CSS-transition не с чего анимировать — фигурка
// будет телепортироваться вместо шага
function walkerSceneHtml(g, sc) {
  return `
    <section class="walker-card" data-goal="${g.id}" data-scene="${sc.id}" style="--w-ink:${sc.ink || '#F3EDE4'}">
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
        ${walkerSky(sc)}
        ${walkerTerrain(sc)}

        ${walkerFinish(sc)}
        <g class="w-walker${sc.motion === 'swim' ? ' w-swimmer' : ''}">${walkerFigure(sc)}</g>
        ${sc.motion === 'swim'
          ? `<g transform="translate(276,97)"><g class="w-arrived">${walkFigure(sc)}</g></g>`
          : ''}
        ${walkerForeground(sc)}

        <g class="w-confetti">
          <circle cx="262" cy="60" r="2"/><circle cx="278" cy="52" r="2"/>
          <circle cx="294" cy="62" r="2"/><circle cx="270" cy="46" r="1.6"/>
        </g>
      </svg>

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

  // путь зависит от механики сцены: идёт по земле, плывёт по воде или лезет вверх.
  // Все траектории держим в видимой зоне [20,300] по X (slice-кроп на мобиле).
  const pos = walkerPath(sc, done / total);
  const man = card.querySelector('.w-walker');
  const prevX = Number(card.dataset.x), prevY = Number(card.dataset.y);
  const moved = !stale && Number.isFinite(prevX) &&
    (Math.abs(pos.x - prevX) > 0.5 || Math.abs(pos.y - prevY) > 0.5);

  card.dataset.x = String(pos.x);
  card.dataset.y = String(pos.y);
  man.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  card.classList.toggle('finished', finished);
  card.setAttribute('aria-label',
    `Путь к цели: ${g.name}, ${done} из ${total} шагов${finished ? ', дошёл' : ''}`);

  // 01 заголовок — максимальный приоритет, 03 цифры под сценой — тише
  card.querySelector('.w-goal').textContent = g.name;
  card.querySelector('.w-steps').textContent = `${done} / ${total} шагов`;
  card.querySelector('.w-left').textContent = finished
    ? 'Финиш'
    : `осталось ${total - done}`;
  card.querySelector('.w-fill').style.width = `${goalPct(g)}%`;

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
        // «пропуск» — только если день был кому-то обязателен (см. isRequiredOn)
        const missed = sched.some(h => isRequiredOn(h, d));
        dotCls = done === sched.length ? 'full' : (done > 0 ? 'half' : (isToday || !missed ? '' : 'miss'));
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

  // при блокировке показываем НА СКОЛЬКО и что именно блокируется
  const lockApps = h.stake.apps || [];
  const lockTitle = lockApps.length ? lockApps.join(', ') : 'выбранные приложения';
  const stake = h.stake.mode === 'money'
    ? `<span class="stake-badge money">${icon('i-coins')}${h.stake.amount}₽</span>`
    : `<span class="stake-badge lock" title="${escapeHtml(lockTitle)}">${icon('i-lock')}${
        formatLock(h.stake.minutes || LOCK_MINUTES_DEFAULT)}${
        lockApps.length ? ' · ' + escapeHtml(lockApps[0]) + (lockApps.length > 1 ? ` +${lockApps.length - 1}` : '') : ''
      }</span>`;

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
  card.className = 'habit' + (done ? ' done' : '') + (off ? ' off' : '') + (h.pinned ? ' pinned' : '');
  card.dataset.hid = h.id;          // якорь для FLIP-анимации переезда между секциями
  card.innerHTML = `
    <div class="habit-icon">${iconOf(h.icon)}</div>
    <div class="habit-main" data-stats="${h.id}" role="button" tabindex="0" aria-label="Статистика: ${escapeHtml(h.name)}">
      <div class="habit-name">${escapeHtml(h.name)}</div>
      <div class="habit-meta">
        <span class="streak ${streak ? '' : 'zero'}">${icon('i-flame')}${streak}</span>
        ${goalText && !off && !min ? `<span class="goal-text">${goalText}</span>` : ''}
        ${off ? `<span class="goal-text">${schedText}</span>` : ''}
        ${stake}
        ${minHtml}
      </div>
    </div>
    <button class="habit-pin${h.pinned ? ' on' : ''}" data-pin="${h.id}"
      aria-pressed="${h.pinned ? 'true' : 'false'}"
      aria-label="${h.pinned ? 'Открепить' : 'Закрепить'}: ${escapeHtml(h.name)}">
      <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 17v5"/>
        <path d="M9 10.8V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v5.8a2 2 0 0 0 .6 1.4l1.3 1.3A2 2 0 0 1 16.4 17H7.6a2 2 0 0 1-1.5-3.5l1.3-1.3A2 2 0 0 0 9 10.8Z"/>
      </svg>
    </button>
    ${off ? '' : `<button class="habit-check" data-check="${h.id}" aria-label="Отметить: ${escapeHtml(h.name)}">${checkContent}</button>`}
  `;
  return card;
}

/* ---------- СТАТИСТИКА ОТДЕЛЬНОЙ ПРИВЫЧКИ ----------
   Раньше статистика жила отдельной вкладкой и была общей на всё. Теперь она
   привязана к конкретной привычке: тап по карточке — и видно именно её путь.
   Редактирование и удаление уехали в меню-три-точки, чтобы тап по карточке
   не открывал сразу форму. */
let hstatId = null;

function openHabitStats(id) {
  const h = habits.find(x => x.id === id);
  if (!h) return;
  hstatId = id;
  closeHabitMenu();
  renderHabitStats();
  openSheet('hstat-overlay');
}

// сколько раз выполнена за последние N дней и сколько из них было обязательных
function habitStatsFor(h, days = 30) {
  let done = 0, required = 0, missed = 0;
  for (let i = 0; i < days; i++) {
    const d = addDays(new Date(), -i);
    const key = dateKey(d);
    if (key < h.createdAt) break;
    const did = doneOn(h, key);
    if (did) done++;
    if (isRequiredOn(h, d)) {
      required++;
      if (!did && key !== TODAY) missed++;
    }
  }
  return { done, required, missed };
}

function renderHabitStats() {
  const h = habits.find(x => x.id === hstatId);
  const body = document.getElementById('hstat-body');
  if (!h || !body) return;

  document.getElementById('hstat-title').textContent = h.name;

  const streak = computeStreak(h);
  const best = computeBestStreak(h);
  const s30 = habitStatsFor(h, 30);
  const pct30 = s30.required ? Math.round(((s30.required - s30.missed) / s30.required) * 100) : 100;
  const totalDone = Object.keys(h.history || {}).filter(k => doneOn(h, k)).length;

  // штрафы именно этой привычки
  const mine = ledger.filter(e => e.habitId === h.id);
  const money = mine.filter(e => e.mode === 'money').reduce((s, e) => s + (e.amount || 0), 0);
  const locks = mine.filter(e => e.mode === 'lock').length;

  // мини-heatmap по этой привычке за 12 недель
  const weeks = 12;
  const today = new Date();
  const start = addDays(weekStartOf(today), -7 * (weeks - 1));
  let cells = '';
  for (let w = 0; w < weeks; w++) {
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, w * 7 + i);
      const key = dateKey(d);
      let cls = 'off';
      if (key > TODAY) cls = 'future';
      else if (key < h.createdAt) cls = 'off';
      else if (doneOn(h, key)) cls = isMinOn(h, key) ? 'l2' : 'l4';
      else if (isRequiredOn(h, d)) cls = 'miss';
      cells += `<i class="hm-cell ${cls}" title="${formatDay(key)}"></i>`;
    }
  }

  const modeText = isFlexible(h)
    ? `${h.weekTarget} дней в неделю, любые`
    : (h.schedule.length === 7 ? 'каждый день' : h.schedule.map(i => DAY_NAMES[i]).join(' · '));

  const stakeText = h.stake.mode === 'money'
    ? `${h.stake.amount}₽ за пропуск`
    : `${formatLock(h.stake.minutes || LOCK_MINUTES_DEFAULT)} блокировки${
        (h.stake.apps || []).length ? ' · ' + h.stake.apps.map(escapeHtml).join(', ') : ''}`;

  body.innerHTML = `
    <div class="hstat-grid">
      <div class="hstat-tile"><span class="ht-num">${streak}</span><span class="ht-lbl">серия сейчас</span></div>
      <div class="hstat-tile"><span class="ht-num">${best}</span><span class="ht-lbl">лучшая серия</span></div>
      <div class="hstat-tile"><span class="ht-num">${totalDone}</span><span class="ht-lbl">выполнено всего</span></div>
      <div class="hstat-tile"><span class="ht-num">${pct30}%</span><span class="ht-lbl">за 30 дней</span></div>
    </div>

    <span class="field-label">Последние 12 недель</span>
    <div class="hstat-hm">${cells}</div>

    <div class="hstat-rows">
      <div class="ledger-row">
        <span class="ledger-icon">${icon('i-calendar')}</span>
        <div class="ledger-main"><div class="ledger-name">Режим</div>
          <div class="ledger-day">${escapeHtml(modeText)}</div></div>
      </div>
      <div class="ledger-row">
        <span class="ledger-icon">${icon(h.stake.mode === 'money' ? 'i-coins' : 'i-lock')}</span>
        <div class="ledger-main"><div class="ledger-name">Штраф</div>
          <div class="ledger-day">${stakeText}</div></div>
      </div>
      <div class="ledger-row">
        <span class="ledger-icon">${icon('i-alert')}</span>
        <div class="ledger-main"><div class="ledger-name">Пропуски</div>
          <div class="ledger-day">${mine.length} шт.${money ? ' · ' + money + '₽' : ''}${
            locks ? ' · блокировок: ' + locks : ''}</div></div>
      </div>
    </div>`;
}

function closeHabitMenu() {
  const menu = document.getElementById('hstat-menu');
  const btn = document.getElementById('hstat-menu-btn');
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function wireHabitStats() {
  const btn = document.getElementById('hstat-menu-btn');
  const menu = document.getElementById('hstat-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  });
  // клик мимо меню закрывает его, но не саму шторку
  document.getElementById('hstat-overlay').addEventListener('click', () => closeHabitMenu());

  document.getElementById('hstat-edit').addEventListener('click', () => {
    const id = hstatId;
    closeHabitMenu();
    closeSheet('hstat-overlay');
    openEditSheet(id);
  });
  document.getElementById('hstat-minimum').addEventListener('click', () => {
    const h = habits.find(x => x.id === hstatId);
    closeHabitMenu();
    if (!h) return;
    if (!h.min) { toast('У этой привычки не задан минимум'); return; }
    toggleMinMark(h, TODAY);
    render();
    renderHabitStats();
    toast('Минимум сделан — серия продолжается 👊');
  });
  document.getElementById('hstat-del').addEventListener('click', () => {
    const id = hstatId;
    closeHabitMenu();
    const before = habits.length;
    deleteHabit(id);                       // в нём и отвязка от марафона, и confirm
    if (habits.length !== before) closeSheet('hstat-overlay');
  });
}

/* ---------- ЗАКРЕПЛЕНИЕ ----------
   Порт PinnedList: закреплённые уезжают в свою секцию наверх. В оригинале
   плавный переезд делает layoutId из motion/react; здесь то же самое даёт
   техника FLIP — запоминаем позиции ДО перерисовки, после неё сдвигаем
   карточку обратно трансформом и отпускаем в ноль. */
function flipHabits(mutate) {
  const before = new Map();
  document.querySelectorAll('#screen-today .habit[data-hid]').forEach(c =>
    before.set(c.dataset.hid, c.getBoundingClientRect()));

  mutate();

  document.querySelectorAll('#screen-today .habit[data-hid]').forEach(c => {
    const b = before.get(c.dataset.hid);
    if (!b) return;
    const a = c.getBoundingClientRect();
    const dx = b.left - a.left, dy = b.top - a.top;
    if (!dx && !dy) return;
    c.style.animation = 'none';                 // гасим fadeUp, иначе спорит с переездом
    c.style.transition = 'none';
    c.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      c.style.transition = 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)';
      c.style.transform = '';
      setTimeout(() => { c.style.transition = ''; c.style.animation = ''; }, 440);
    });
  });
}

function togglePin(id) {
  const h = habits.find(x => x.id === id);
  if (!h) return;
  flipHabits(() => {
    h.pinned = !h.pinned;
    save();
    apiCall('PUT', `/habits/${h.id}`, h);
    renderHabits();
  });
}

function renderHabits() {
  const list = document.getElementById('habit-list');
  const offList = document.getElementById('offday-list');
  const offBlock = document.getElementById('offday-block');
  const pinnedList = document.getElementById('pinned-list');
  const pinnedBlock = document.getElementById('pinned-block');
  const empty = document.getElementById('empty-state');
  list.innerHTML = '';
  offList.innerHTML = '';
  pinnedList.innerHTML = '';

  empty.hidden = habits.length > 0;
  document.getElementById('btn-day-summary').hidden = habits.length === 0;

  const todays = habits.filter(isScheduledToday);
  const off = habits.filter(h => !isScheduledToday(h));

  // закреплённые — отдельной секцией наверху; секции нет, пока некого показывать
  const pinned = todays.filter(h => h.pinned);
  const rest = todays.filter(h => !h.pinned);
  pinned.forEach(h => pinnedList.appendChild(habitCard(h, false)));
  pinnedBlock.hidden = pinned.length === 0;
  document.getElementById('mine-title').hidden = rest.length === 0;

  rest.forEach(h => list.appendChild(habitCard(h, false)));
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
  document.querySelectorAll('#screen-today [data-pin]').forEach(b =>
    b.addEventListener('click', () => togglePin(b.dataset.pin)));
  // тап по карточке — статистика этой привычки (редактирование — в меню внутри)
  document.querySelectorAll('#screen-today [data-stats]').forEach(b => {
    b.addEventListener('click', () => openHabitStats(b.dataset.stats));
    b.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHabitStats(b.dataset.stats); }
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
  // провал засчитываем, только если день был обязателен хоть для одной привычки
  const wasRequired = sched.some(h => isRequiredOn(h, d));
  return (key < TODAY && wasRequired) ? 'fail' : 'plain';
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
      else if (key < TODAY && isRequiredOn(h, d)) failCount++;
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
  const motSlider = document.getElementById('mot-level');
  motSlider.value = lvl;
  motSlider._paint?.();        // значение выставили из профиля — подтянуть заливку трека
  document.getElementById('mot-out').textContent = lvl + '%';
  document.getElementById('mot-text').value = profile.motivation?.text || '';

  // переключатель — не чекбокс, состояние живёт в aria-checked (+ положение ползунка)
  const offdaySw = document.getElementById('set-offday');
  if (offdaySw) {
    offdaySw.setAttribute('aria-checked', String(!!settings.showOffday));
    offdaySw.style.setProperty('--as-x', (settings.showOffday ? SWITCH_TRAVEL : 0) + 'px');
  }

  renderRewards();
  renderFriends();
  renderThemeGrid();
  renderAccount();
}

/* ---------- ДОСТИЖЕНИЯ ----------
   Считаем текущее значение по каждому виду; медаль получена, если оно ≥ порога.
   Штрафы деньгами считаем ПО ЧИСЛУ (сколько раз оштрафовался), а не по сумме. */
function medalMetrics() {
  return {
    friends: friends.length,
    streak: habits.length ? Math.max(...habits.map(computeBestStreak)) : 0,
    marathons: goals.filter(g => isMarathon(g) && goalPct(g) >= 100).length,
    locks: ledger.filter(e => e.mode === 'lock').length,
    fines: ledger.filter(e => e.mode === 'money').length
  };
}

// иконка достижения: 3D-картинка поверх SVG-запаски. Битую картинку удаляем
// (см. wireMedalArt) — тогда остаётся SVG, приложение не ломается без файла.
function medalIconHtml(m) {
  const art = m.art ? 'icons/medals/' + m.art : null;
  return `<span class="m-ic">
    ${art ? `<img class="m-art" src="${art}" alt="" loading="lazy">` : ''}
    <span class="m-fallback">${icon(MEDAL_FALLBACK[m.kind] || 'i-award')}</span>
  </span>`;
}
// нет файла картинки → убираем <img>, остаётся SVG
function wireMedalArt(box) {
  box.querySelectorAll('.m-art').forEach(img =>
    img.addEventListener('error', () => img.remove()));
}

// строка достижения на экране: иконка + название + описание + статус
function medalRowHtml(m, cur) {
  const earned = cur >= m.at;
  const status = earned
    ? `<span class="mr-badge">${icon('i-check', 'ic ic-s')} есть</span>`
    : `<span class="mr-progress">${Math.min(cur, m.at)} / ${m.at}</span>`;
  return `
    <div class="medal-row ${earned ? 'earned ' + m.cls : 'locked'}">
      ${medalIconHtml(m)}
      <div class="mr-main">
        <div class="mr-name">${escapeHtml(m.name)}</div>
        <div class="mr-desc">${escapeHtml(m.desc || '')}</div>
      </div>
      ${status}
    </div>`;
}

// компактная карточка в профиле: прогресс + несколько последних значков
function renderMedals() {
  const preview = document.getElementById('ach-preview');
  if (!preview) return;
  const metrics = medalMetrics();
  const earned = MEDALS.filter(m => metrics[m.kind] >= m.at);

  document.getElementById('ach-count').textContent = `${earned.length} / ${MEDALS.length}`;
  document.getElementById('ach-fill').style.width =
    Math.round((earned.length / MEDALS.length) * 100) + '%';

  // показываем последние полученные, а если их нет — ближайшие к получению
  const show = earned.length
    ? earned.slice(-5)
    : MEDALS.slice().sort((a, b) =>
        (b.at ? metrics[b.kind] / b.at : 0) - (a.at ? metrics[a.kind] / a.at : 0)).slice(0, 5);

  preview.innerHTML = show.map(m => `
    <span class="ach-chip ${earned.includes(m) ? 'on' : ''}" title="${m.name}">
      ${medalIconHtml(m)}
    </span>`).join('');
  wireMedalArt(preview);
}

// экран со всей коллекцией: сначала полученные, потом закрытые
function renderMedalsScreen() {
  const earnedBox = document.getElementById('ach-earned');
  const lockedBox = document.getElementById('ach-locked');
  if (!earnedBox || !lockedBox) return;

  const metrics = medalMetrics();
  const earned = MEDALS.filter(m => metrics[m.kind] >= m.at);
  const locked = MEDALS.filter(m => metrics[m.kind] < m.at);

  document.getElementById('ach-screen-count').textContent =
    `${earned.length} / ${MEDALS.length}`;
  document.getElementById('ach-screen-fill').style.width =
    Math.round((earned.length / MEDALS.length) * 100) + '%';

  earnedBox.innerHTML = earned.map(m => medalRowHtml(m, metrics[m.kind])).join('');
  // закрытые — ближе к получению сверху, чтобы было видно, что вот-вот откроется
  lockedBox.innerHTML = locked
    .slice()
    .sort((a, b) => (metrics[b.kind] / b.at) - (metrics[a.kind] / a.at))
    .map(m => medalRowHtml(m, metrics[m.kind])).join('');

  document.getElementById('ach-earned-block').hidden = earned.length === 0;
  document.getElementById('ach-locked-block').hidden = locked.length === 0;
  wireMedalArt(earnedBox);
  wireMedalArt(lockedBox);
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
  // новая цель — предлагаем 30 (подтолкнуть к марафону); существующая —
  // показываем её шаги как есть (0/undefined → 0, чтобы правка не превратила
  // старую ручную цель в марафон незаметно)
  document.getElementById('g-steps').value = g ? (g.steps || 0) : 30;
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
/* Доска соревнования. Честно: данных о чужом прогрессе у нас пока нет —
   друзья хранятся локально, без серверных аккаунтов. Поэтому показываем СВОЙ
   результат как ориентир и не выдумываем чужие цифры. */
function renderFriendsBoard() {
  const box = document.getElementById('friends-board');
  if (!box) return;

  const myStreak = bestCurrentStreak();
  const pct = weekCompletion(weekStartOf(new Date()));   // null, если на неделе ничего не было
  const myWeek = pct === null ? '—' : pct + '%';

  if (!friends.length) {
    box.innerHTML = `<p class="hint" style="margin:0">Добавь друга — и здесь появится, кто на какой серии.</p>`;
    return;
  }
  box.innerHTML = `
    <div class="friend-row">
      <span class="friend-ava">${avatarHtml(profile)}</span>
      <span class="friend-name">${escapeHtml(profile.name || 'Ты')}</span>
      <span class="goal-text">${icon('i-flame', 'ic ic-s')} ${myStreak} · ${myWeek}</span>
    </div>
    ${friends.map(f => `
      <div class="friend-row">
        <span class="friend-ava">${escapeHtml(f.emoji || '🙂')}</span>
        <span class="friend-name">${escapeHtml(f.name)}</span>
        <span class="goal-text dim">ждёт аккаунт</span>
      </div>`).join('')}
    <p class="hint" style="margin:8px 0 0">Чужие серии подтянутся, когда друзья будут по аккаунтам,
      а не локальным списком.</p>`;
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
  if (name === 'friends') { renderFriends(); renderFriendsBoard(); }
  if (name === 'medals') renderMedalsScreen();
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
    // цвет фигурки задаёт сцена (на снегу — тёмная), как и в самой карточке
    b.style.setProperty('--w-ink', sc.ink || '#F3EDE4');
    // превью — та же сцена, что и в марафоне: небо, рельеф, финиш и фигурка
    // на середине пути. Это стоп-кадр: анимации в пикере выключены (CSS).
    const p = walkerPath(sc, 0.45);
    b.innerHTML = `
      <span class="sp-art">
        <svg class="sp-svg" viewBox="0 0 320 132" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs>
            <linearGradient id="sp-sky-${sc.id}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="${sc.sky[0]}"/>
              <stop offset="0.55" stop-color="${sc.sky[1]}"/>
              <stop offset="1" stop-color="${sc.sky[2]}"/>
            </linearGradient>
          </defs>
          <rect width="320" height="132" fill="url(#sp-sky-${sc.id})"/>
          ${walkerSky(sc)}
          ${walkerTerrain(sc)}
          ${walkerFinish(sc)}
          <g transform="translate(${p.x},${p.y})">${walkerFigure(sc)}</g>
          ${walkerForeground(sc)}
        </svg>
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
// одиночный выбор в пикере: снимаем выделение с ЛЮБОГО выбранного элемента
// контейнера (не только .pick — иначе сцены с классом .scene-pick не сбрасывались
// и выбиралось несколько сразу, а сохранялась всегда первая = пустыня)
function selectIn(container, btn) {
  container.querySelectorAll('.selected').forEach(p => p.classList.remove('selected'));
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

/* ---------- ПЕРЕКЛЮЧАТЕЛЬ (порт AppleSwitch на ваниль) ----------
   Оригинал на motion/react; здесь то же поведение без React:
   • клик переключает;
   • ползунок можно ПОТЯНУТЬ — на отпускании доводится к ближнему краю;
   • при нажатии «капля» растягивается (класс .grabbing);
   • клик, который браузер шлёт сразу после перетаскивания, гасим. */
const SWITCH_TRAVEL = 22;            // 62 − 32 − 4*2, метрики размера md из оригинала

function initSwitch(el, onChange) {
  if (!el || el.dataset.asWired) return;
  el.dataset.asWired = '1';

  let pointerId = null, startX = 0, startThumb = 0, dragging = false, suppressClick = false;
  const isOn = () => el.getAttribute('aria-checked') === 'true';
  const setX = px => el.style.setProperty('--as-x', px + 'px');
  const curX = () => parseFloat(el.style.getPropertyValue('--as-x')) || 0;

  const apply = (on, notify) => {
    el.setAttribute('aria-checked', String(on));
    setX(on ? SWITCH_TRAVEL : 0);
    if (notify) onChange?.(on);
  };
  setX(isOn() ? SWITCH_TRAVEL : 0);          // стартовое положение без анимации

  el.addEventListener('pointerdown', e => {
    if (el.disabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    pointerId = e.pointerId;
    startX = e.clientX;
    startThumb = isOn() ? SWITCH_TRAVEL : 0;
    dragging = false;
    el.classList.add('grabbing');
  });

  el.addEventListener('pointermove', e => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 3) {
      dragging = true;
      el.classList.add('dragging');          // снимает доводчик: идём за пальцем
    }
    if (!dragging) return;
    e.preventDefault();
    setX(Math.min(SWITCH_TRAVEL, Math.max(0, startThumb + dx)));
  });

  const finish = e => {
    if (pointerId === null) return;
    if (e?.pointerId != null && el.hasPointerCapture?.(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    pointerId = null;
    el.classList.remove('grabbing', 'dragging');
    if (!dragging) return;                   // это был обычный клик — обработает click
    dragging = false;
    suppressClick = true;
    apply(curX() >= SWITCH_TRAVEL / 2, true);
  };
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', finish);

  el.addEventListener('click', () => {
    if (el.disabled) return;
    if (suppressClick) { suppressClick = false; return; }
    apply(!isOn(), true);                    // сюда же приходят Space/Enter с клавиатуры
  });

  // клик по подписи строки тоже переключает — как <label> в оригинале.
  // Клики по самому переключателю пропускаем, иначе сработает дважды.
  const row = el.closest('.setting-row');
  if (row) {
    row.addEventListener('click', e => {
      if (el.disabled || e.target.closest('.aswitch')) return;
      el.click();
    });
  }
}

/* ---------- СЛАЙДЕР (тот же язык, что у переключателя) ----------
   Нативный <input type="range"> оставляем ради доступности и клавиатуры,
   меняем только вид: --val красит заполненную часть трека, класс .grabbing
   растягивает «каплю» на время перетаскивания. */
function initSlider(el, onInput) {
  if (!el || el.dataset.asWired) return;
  el.dataset.asWired = '1';

  const paint = () => {
    const min = Number(el.min) || 0;
    const max = Number(el.max) || 100;
    const pct = max > min ? ((Number(el.value) - min) / (max - min)) * 100 : 0;
    el.style.setProperty('--val', Math.max(0, Math.min(100, pct)) + '%');
  };
  el._paint = paint;            // вызвать после программной установки value
  paint();

  el.addEventListener('input', () => { paint(); onInput?.(el.value); });
  el.addEventListener('pointerdown', () => el.classList.add('grabbing'));
  ['pointerup', 'pointercancel', 'blur'].forEach(ev =>
    el.addEventListener(ev, () => el.classList.remove('grabbing')));
}

/* ---------- БЛОКИРОВКА: на сколько ---------- */
const LOCK_MINUTES_DEFAULT = 60;
function lockMinutesValue() {
  const raw = Number(document.getElementById('f-lock-mins')?.value) || LOCK_MINUTES_DEFAULT;
  return Math.max(15, Math.min(1440, Math.round(raw / 15) * 15));   // 15 мин … сутки
}
// 60 → «1 ч», 90 → «1 ч 30 мин», 45 → «45 мин»
function formatLock(mins) {
  const m = Math.max(0, Number(mins) || 0);
  if (!m) return '';
  const h = Math.floor(m / 60), rest = m % 60;
  if (!h) return `${rest} мин`;
  return rest ? `${h} ч ${rest} мин` : `${h} ч`;
}
// подпись рядом с полем показывает человекочитаемую длительность
function updateLockSuffix() {
  const el = document.getElementById('f-lock-suffix');
  if (el) el.textContent = `мин — это ${formatLock(lockMinutesValue())} за пропуск`;
}

/* ---------- «СКОЛЬКО ДНЕЙ В НЕДЕЛЮ» (гибкий режим) ---------- */
let wtValue = 0;                       // 0 = выкл, строго по дням недели
function setWeekTarget(n, animate = true) {
  wtValue = Math.max(0, Math.min(7, n));
  const card = document.getElementById('wt-card');
  const count = document.getElementById('wt-count');
  if (!card || !count) return;

  const on = wtValue > 0;
  card.classList.toggle('off', !on);
  document.getElementById('day-picker').classList.toggle('dimmed', on);
  document.getElementById('wt-sub').textContent = on
    ? 'Любые дни — важна норма за неделю'
    : 'Строго по выбранным дням';
  document.getElementById('wt-minus').disabled = wtValue <= 0;
  document.getElementById('wt-plus').disabled = wtValue >= 7;

  // при открытии шторки показываем значение без анимации: снимаем прошлое
  // состояние счётчика (именно delete — присваивание undefined положило бы
  // в data-атрибут строку "undefined", и она бы улетала в анимации)
  if (!animate) delete count.dataset.acValue;
  animateCount(count, on ? wtValue : '—');
}
function wireWeekTarget() {
  const minus = document.getElementById('wt-minus');
  const plus = document.getElementById('wt-plus');
  if (!minus || !plus) return;
  minus.addEventListener('click', () => setWeekTarget(wtValue - 1));
  plus.addEventListener('click', () => setWeekTarget(wtValue + 1));
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
  setWeekTarget(Number(h.weekTarget) || 0, false);
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
    document.getElementById('f-lock-mins').value = h.stake.minutes || LOCK_MINUTES_DEFAULT;
    updateLockSuffix();
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
  document.getElementById('f-lock-mins').value = LOCK_MINUTES_DEFAULT;
  updateLockSuffix();
  document.getElementById('f-min').value = '';
  buildPickers();
  buildDayPicker();
  setWeekTarget(0, false);
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

  // в гибком режиме конкретные дни не важны — привычка доступна в любой день
  const weekTarget = wtValue;
  const schedule = weekTarget > 0 ? [0,1,2,3,4,5,6] : selectedDays();
  if (!weekTarget && !schedule.length) {
    alert('Выбери хотя бы один день недели — или задай, сколько дней в неделю');
    return;
  }

  const goalType = segValue('goal-type', 'goal');
  const stakeMode = segValue('stake-mode', 'stake');

  const data = {
    name,
    icon: document.querySelector('#icon-picker .selected').dataset.icon,
    color: document.querySelector('#color-picker .selected').dataset.color,
    schedule,
    weekTarget,
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
          minutes: lockMinutesValue(),
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
  const list = goals.filter(isMarathon);
  if (!list.length) return '';

  const rows = list.map(g => {
    const total = g.steps;
    const done = Math.min(stepsDone(g), total);
    const scheduled = marathonHabits(g).filter(isScheduledToday);
    const madeToday = scheduled.filter(isDoneToday).length;
    const pending = scheduled.length - madeToday;
    const streak = marathonStreak(g);

    // дошёл — хвалим; идёт с непройденными на сегодня — путник стоит; иначе — плюс шаги
    const status = goalPct(g) >= 100
      ? `<b style="color:var(--primary)">финиш пройден — путник дошёл 🎉</b>`
      : pending > 0
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
      const maxLock = Math.max(...notDone
        .filter(h => h.stake.mode === 'lock')
        .map(h => Number(h.stake.minutes) || LOCK_MINUTES_DEFAULT));
      html += `<div class="summary-row"><span class="big lock">${icon('i-lock')}</span>
        <div><div>Заблокируются приложения${maxLock ? ' на ' + formatLock(maxLock) : ''}</div>
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
  wireWeekTarget();
  wireHabitStats();
  document.getElementById('btn-open-stats').addEventListener('click', () => switchScreen('stats'));
  const achCard = document.getElementById('ach-card');
  achCard.addEventListener('click', () => switchScreen('medals'));
  achCard.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchScreen('medals'); }
  });
  setWeekTarget(0, false);
  document.getElementById('f-lock-mins').addEventListener('input', updateLockSuffix);
  updateLockSuffix();

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
  initSlider(document.getElementById('mot-level'), v => {
    document.getElementById('mot-out').textContent = v + '%';
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
  initSwitch(document.getElementById('set-offday'), on => {
    settings.showOffday = on;
    saveJson(SETTINGS_KEY, settings);
    renderHabits();
  });
  // «Итог дня при запуске» — выключить нельзя, но переключатель должен выглядеть живым
  document.querySelectorAll('.aswitch[disabled]').forEach(el => initSwitch(el));
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
