/* ============================================================
   disbit — логика прототипа
   Всё хранится в localStorage. Бэкенда пока нет.
   Ставки (деньги/блокировка) — СИМУЛЯЦИЯ, ничего реального не происходит.
   ============================================================ */

const STORAGE_KEY = 'disbit_habits_v1';

// наборы для выбора при создании привычки
const ICONS  = ['📚','💧','🏃','🧘','🦷','💪','🥗','😴','✍️','🎯','🧹','🎸'];
const COLORS = ['#3B82F6','#FB923C','#FBBF24','#F472B6','#34D399','#A78BFA','#22D3EE','#F87171'];

let habits = load();
let editingId = null;   // id привычки в режиме редактирования (null = создаём новую)

/* ---------- ХРАНИЛИЩЕ ---------- */
function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(habits));
}

/* ---------- ДАТЫ ---------- */
// ключ дня в локальном времени: 'YYYY-MM-DD'
function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const TODAY = dateKey();

/* ---------- ЛОГИКА ПРИВЫЧЕК ---------- */

// выполнена ли привычка сегодня
function isDoneToday(h) {
  if (h.goal.type === 'count') {
    return (h.counts?.[TODAY] || 0) >= h.goal.target;
  }
  return !!h.history?.[TODAY];
}

// текущий стрик (сколько дней подряд выполнено)
// если сегодня ещё не выполнено — стрик не рвётся, считаем со вчера
function computeStreak(h) {
  const hist = h.history || {};
  let streak = 0;
  const d = new Date();
  if (!hist[dateKey(d)]) d.setDate(d.getDate() - 1);
  while (hist[dateKey(d)]) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// нажатие на кнопку отметки
function toggleHabit(id) {
  const h = habits.find(x => x.id === id);
  if (!h) return;
  h.history = h.history || {};

  if (h.goal.type === 'count') {
    h.counts = h.counts || {};
    const cur = h.counts[TODAY] || 0;
    if (cur >= h.goal.target) {
      h.counts[TODAY] = 0;            // уже выполнено → сбрасываем (можно поправить)
    } else {
      h.counts[TODAY] = cur + 1;      // +1 к счётчику
    }
    h.history[TODAY] = h.counts[TODAY] >= h.goal.target;
  } else {
    h.history[TODAY] = !h.history[TODAY];  // простое вкл/выкл
  }
  save();
  render();
}

function deleteHabit(id) {
  if (!confirm('Удалить привычку?')) return;
  habits = habits.filter(x => x.id !== id);
  save();
  render();
}

/* ---------- РЕНДЕР ---------- */

function render() {
  renderWeek();
  renderHabits();
  renderProgress();
}

// полоска дней недели (текущая неделя Пн–Вс, сегодня выделено)
function renderWeek() {
  const names = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const now = new Date();
  // находим понедельник текущей недели
  const monday = new Date(now);
  const shift = (now.getDay() + 6) % 7; // 0=Пн ... 6=Вс
  monday.setDate(now.getDate() - shift);

  const box = document.getElementById('week-strip');
  box.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const isToday = dateKey(d) === TODAY;
    const el = document.createElement('div');
    el.className = 'day' + (isToday ? ' today' : '');
    el.innerHTML = `<span class="dname">${names[i]}</span><span class="dnum">${d.getDate()}</span>`;
    box.appendChild(el);
  }
}

function renderHabits() {
  const list = document.getElementById('habit-list');
  const empty = document.getElementById('empty-state');
  list.innerHTML = '';

  empty.hidden = habits.length > 0;

  habits.forEach(h => {
    const done = isDoneToday(h);
    const streak = computeStreak(h);

    // содержимое кнопки отметки
    let checkContent = '✓';
    if (!done && h.goal.type === 'count') {
      checkContent = h.counts?.[TODAY] || 0;
    } else if (!done) {
      checkContent = '';
    }

    // подпись цели в мете
    const goalText = h.goal.type === 'count'
      ? `${h.counts?.[TODAY] || 0}/${h.goal.target} ${h.goal.unit || ''}`.trim()
      : '';

    // бейдж ставки
    const stake = h.stake.mode === 'money'
      ? `<span class="stake-badge money">💸 ${h.stake.amount}₽</span>`
      : `<span class="stake-badge lock">🔒 ${(h.stake.apps || []).length || ''} прил.</span>`;

    const card = document.createElement('div');
    card.className = 'habit' + (done ? ' done' : '');
    card.innerHTML = `
      <div class="habit-icon" style="background:${h.color}22">${h.icon}</div>
      <div class="habit-main" data-edit="${h.id}">
        <div class="habit-name">${escapeHtml(h.name)}</div>
        <div class="habit-meta">
          <span class="streak ${streak ? '' : 'zero'}">🔥 ${streak}</span>
          ${goalText ? `<span style="color:var(--muted-2);font-size:12px">${goalText}</span>` : ''}
          ${stake}
        </div>
      </div>
      <button class="habit-del" data-del="${h.id}" title="Удалить">✕</button>
      <button class="habit-check" data-check="${h.id}">${checkContent}</button>
    `;
    list.appendChild(card);
  });

  // вешаем обработчики
  list.querySelectorAll('[data-check]').forEach(b =>
    b.addEventListener('click', () => toggleHabit(b.dataset.check)));
  list.querySelectorAll('[data-del]').forEach(b =>
    b.addEventListener('click', () => deleteHabit(b.dataset.del)));
  list.querySelectorAll('[data-edit]').forEach(b =>
    b.addEventListener('click', () => openEditSheet(b.dataset.edit)));
}

function renderProgress() {
  const total = habits.length;
  const done = habits.filter(isDoneToday).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  document.getElementById('done-count').textContent = done;
  document.getElementById('total-count').textContent = total;
  document.getElementById('ring-label').textContent = pct + '%';

  // заполнение кольца: окружность ≈ 327
  const C = 327;
  document.getElementById('ring-fg').style.strokeDashoffset = C - (C * pct) / 100;

  // сумма «под риском» — невыполненные привычки со ставкой деньгами
  const notDone = habits.filter(h => !isDoneToday(h));
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

/* ---------- ШТОРКА ДОБАВЛЕНИЯ ---------- */

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
  // сброс выборов к первому варианту
  buildPickers();
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

  const goalType = segValue('goal-type', 'goal');
  const stakeMode = segValue('stake-mode', 'stake');

  // данные из формы (без id/counts/history — их не трогаем при редактировании)
  const data = {
    name,
    icon: document.querySelector('#icon-picker .selected').dataset.icon,
    color: document.querySelector('#color-picker .selected').dataset.color,
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
    // обновляем существующую, сохраняя прогресс (counts/history/id)
    const h = habits.find(x => x.id === editingId);
    if (h) Object.assign(h, data);
  } else {
    habits.push({ id: 'h' + Date.now(), ...data, counts: {}, history: {} });
  }

  save();
  closeAddSheet();
  render();
}

/* ---------- ИТОГ ДНЯ (СИМУЛЯЦИЯ) ---------- */

function showDaySummary() {
  const notDone = habits.filter(h => !isDoneToday(h));
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
        <div class="label">списалось бы при невыполнении</div></div>`;
      if (charity) html += `<div class="summary-row"><span class="big">❤️</span>
        <div><div>Благотворительность</div><b>${charity}₽</b></div></div>`;
      if (creators) html += `<div class="summary-row"><span class="big">🛠️</span>
        <div><div>Создателям</div><b>${creators}₽</b></div></div>`;
    }
    if (apps.size) {
      html += `<div class="summary-row"><span class="big">🔒</span>
        <div><div>Заблокировались бы приложения</div>
        <b>${[...apps].join(', ')}</b></div></div>`;
    }
    body.innerHTML = html;
  }
  document.getElementById('summary-overlay').hidden = false;
}

/* ---------- УТИЛИТЫ ---------- */
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- ИНИЦИАЛИЗАЦИЯ ---------- */
function init() {
  buildPickers();

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

  // кнопки
  document.getElementById('btn-add').addEventListener('click', openAddSheet);
  document.getElementById('btn-cancel').addEventListener('click', closeAddSheet);
  document.getElementById('btn-save').addEventListener('click', submitHabit);
  document.getElementById('btn-day-summary').addEventListener('click', showDaySummary);
  document.getElementById('btn-summary').addEventListener('click', showDaySummary);
  document.getElementById('btn-summary-close').addEventListener('click', () => {
    document.getElementById('summary-overlay').hidden = true;
  });

  // закрытие шторок по клику на затемнение
  document.getElementById('add-overlay').addEventListener('click', e => {
    if (e.target.id === 'add-overlay') closeAddSheet();
  });
  document.getElementById('summary-overlay').addEventListener('click', e => {
    if (e.target.id === 'summary-overlay') document.getElementById('summary-overlay').hidden = true;
  });

  render();
}

document.addEventListener('DOMContentLoaded', init);
