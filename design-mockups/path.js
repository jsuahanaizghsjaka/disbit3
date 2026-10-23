const STORAGE_KEY = 'disbit-path-prototype-v1';
const TABS = [
  ['today', 'Сегодня', 'home'],
  ['marathon', 'Марафон', 'map'],
  ['create', 'Создать', 'plus'],
  ['friends', 'Друзья', 'users'],
  ['profile', 'Профиль', 'user'],
];
const ICONS = { book: 'book', run: 'run', moon: 'moon' };
const COLORS = {
  blue: { name: 'Синий', value: '#14233B', icon: '#4E78FF' },
  green: { name: 'Зелёный', value: '#14233B', icon: '#36C58A' },
  peach: { name: 'Песочный', value: '#14233B', icon: '#F3B44B' },
  plum: { name: 'Коралловый', value: '#14233B', icon: '#EE6A5F' },
};
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const icon = (name, className = '') => `<svg class="icon ${className}" aria-hidden="true"><use href="#p-${name}"></use></svg>`;
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const daysLabel = count => `${count} ${count === 1 ? 'день' : count >= 2 && count <= 4 ? 'дня' : 'дней'}`;
const timesLabel = count => `${count} ${count === 1 ? 'раз' : count >= 2 && count <= 4 ? 'раза' : 'раз'}`;

function avatar() {
  return `<svg class="avatar-art" viewBox="0 0 52 52" role="img" aria-label="Аватар: путешественник в походной шляпе">
    <path d="M8 50q1-15 18-15t18 15" fill="#6c7e80"/><path d="m18 38 8 7 8-7-4-5h-8Z" fill="#b77d56"/>
    <path d="M16 20q0-13 12-12t10 16l-3 9q-8 9-16-1Z" fill="#d8ac82"/><path d="M17 21q-3-10 8-13l12 8-1 6-5-7-12 8Z" fill="#493b34"/>
    <path d="M13 17 17 7q10-4 18 2l3 10" fill="#c8a475"/><path d="m15 14 22 2 1 4-24-2Z" fill="#645044"/>
    <path d="M7 19q18-4 36 2l-2 4q-16-1-31-1Z" fill="#e0bf8e"/><path d="M10 24q15-4 31 1" fill="none" stroke="#9b7958" stroke-width="1.2"/>
    <path d="m29 25 1 5h-3" fill="none" stroke="#b17b59" stroke-width="1.3"/><circle cx="24" cy="26" r="1.1" fill="#352e2c"/><circle cx="33" cy="26" r="1.1" fill="#352e2c"/>
    <path d="M24 33q4 2 7 0" fill="none" stroke="#815943" stroke-width="1.3" stroke-linecap="round"/><path d="m19 37 7 7 9-7-3 9-7 3Z" fill="#485c70"/>
    <path d="m15 40-2 10m24-10 2 10" stroke="#d0ac79" stroke-width="4"/>
  </svg>`;
}

function traveler() {
  return `<svg class="traveler" viewBox="0 0 220 300" role="img" aria-label="Путешественник в шляпе, походной одежде и с рюкзаком идёт через пустыню">
    <ellipse cx="113" cy="281" rx="64" ry="7" fill="#29272b" opacity=".3"/>
    <g class="traveler-body">
      <g class="traveler-arm-back">
        <path d="m130 94 18 5 13 40-9 8-19-30Z" fill="#566767"/>
        <path d="m151 139 10-3 13 35-5 9-7-6Z" fill="#b98260"/>
        <path d="m167 171 5-2 5 7-3 8-6-2Z" fill="#c69a74"/>
      </g>
      <g class="traveler-leg-back">
        <path d="m110 165 27 5-9 49-38 39-13-9 28-43Z" fill="#84745e"/>
        <path d="m110 176 12 2-10 34-28 38" fill="none" stroke="#665d50" stroke-width="3"/>
        <path d="m78 246 15 10-3 10-14 7-22-8 1-7 16-1Z" fill="#4d4139"/>
        <path d="m55 264 22 6 14-7-1 6-15 7-22-7Z" fill="#282b2d"/>
        <path d="m74 252 11 7m-15-3 10 6" stroke="#ac9575" stroke-width="2"/>
      </g>
      <g class="traveler-pack">
        <path d="M58 80q9-14 27-10l12 7 8 75-17 17-31-7q-11-39 1-82Z" fill="#576259"/>
        <path d="M57 82q7-7 26-5l9 8-1 62-8 11-23-7Z" fill="#738070"/>
        <path d="m60 106 27 3-1 33-27-3Z" fill="#87917b"/>
        <path d="m59 107 26 2-2 10-22-2Z" fill="#a0a38b"/>
        <path d="m66 80-3 69m20-67-3 71" fill="none" stroke="#414d47" stroke-width="4"/>
        <path d="m62 115 7 1-1 7-7-1m17-5 7 1-1 7-7-1" fill="#c5b58e"/>
        <rect x="48" y="65" width="46" height="18" rx="8" fill="#9b9377" transform="rotate(8 71 74)"/>
        <ellipse cx="52" cy="72" rx="7" ry="9" fill="#6c6c5c"/>
        <ellipse cx="52" cy="72" rx="3.5" ry="5" fill="none" stroke="#b9ae8d" stroke-width="1.4"/>
        <path d="m66 65-2 16m18-14-2 17" stroke="#3f4d49" stroke-width="4"/>
        <path d="m47 123 10-1 4 29-11 3Z" fill="#9bacb1"/><path d="m48 122 7-1-1-5-6 1Z" fill="#46596a"/>
        <path d="m49 130 8-1m-7 5 8-1" stroke="#d5d9d0" stroke-width="2"/>
      </g>
      <g class="traveler-leg-front">
        <path d="m92 163 29-1 6 45 21 52-18 8-28-50-12-34Z" fill="#b19b77"/>
        <path d="m111 179 7 33 18 42" fill="none" stroke="#8f7d62" stroke-width="3"/>
        <path d="m102 187 15-2 4 19-15 3Z" fill="#a38e6c" stroke="#85775f" stroke-width="1.5"/>
        <path d="m104 190 14-2m-10 15 9-2" stroke="#cab58d" stroke-width="1.5"/>
        <path d="m129 255 18-7 7 14 18 6 1 9-32 1-11-7Z" fill="#655142"/>
        <path d="m140 274 33-1v6l-34 2-10-7v-5Z" fill="#2f3030"/>
        <path d="m142 258 10 3m-8 1 12 3m-10 1 12 3" stroke="#c6ae87" stroke-width="2"/>
      </g>
      <path d="M92 85q15-9 35 1l15 22-7 62q-20 10-44-1l-7-51Z" fill="#9baca4"/>
      <path d="m91 100 6 53 5 18-12-2-7-52Z" fill="#75877f"/>
      <path d="m119 94 10 10-4 60-6 5Z" fill="#c1c4ac"/>
      <path d="m102 105 12-2 1 22-13 1Z" fill="#83978f" stroke="#617970" stroke-width="1.2"/>
      <path d="m102 107 12-1-2 6-8 1Z" fill="#b0baaa"/><circle cx="109" cy="110" r="1" fill="#4f665f"/>
      <path d="m132 112-4 37m-30 4 11 4m14-13 8-3" fill="none" stroke="#6f847b" stroke-width="1.5"/>
      <path d="m89 166 47-1-1 8-44 1Z" fill="#534d40"/><rect x="113" y="165" width="10" height="9" rx="1" fill="#cbb990"/><rect x="116" y="167" width="4" height="5" fill="#615947"/>
      <path d="M88 79q15 2 20 18l-8 47" fill="none" stroke="#424f48" stroke-width="9" stroke-linecap="round"/>
      <path d="M89 79q13 3 16 18l-7 40" fill="none" stroke="#b9ad86" stroke-width="4" stroke-linecap="round"/>
      <rect x="99" y="113" width="10" height="7" rx="1" fill="#d9c99b" transform="rotate(10 104 116)"/>
      <g class="traveler-arm-front">
        <path d="M95 96q-9 0-12 12l-1 27 15 9 17-29q0-16-19-19Z" fill="#aab6a5"/>
        <path d="m82 127 20 7-5 13-18-8Z" fill="#c5c7ad"/>
        <path d="m85 139 10 5-5 21 23 10-4 10-30-11q-4-3-3-9Z" fill="#c69972"/>
        <path d="m110 173 9 2 5 7-5 6-13-5Z" fill="#dbb18a"/><path d="m116 179 4 5m-7-3 3 5" stroke="#a77b59" stroke-width="1.4"/>
        <path d="m87 147 7 3-2 7-8-3Z" fill="#34464d"/><circle cx="88" cy="152" r="3" fill="#c5d0c3"/>
      </g>
      <path d="m110 67-2 17 12 11 13-10-6-21Z" fill="#c49269"/>
      <path d="m108 80 12 11 15-7-4 13-12 6-14-13Z" fill="#475c72"/>
      <path d="m119 96 8 22 10-7-8-18" fill="#61768a"/>
      <path d="M107 37q8-11 24-6 16 5 14 21l6 10-8 5-3 13q-14 10-26-4l-8-21Z" fill="#d5a77d"/>
      <path d="m109 44 8 6-2 17 7 12-8-3-8-21Z" fill="#b17b58"/>
      <path d="M105 40q-1-17 21-17 21 2 19 22l-7-3-13-6-10 15-7 1Z" fill="#453a31"/>
      <ellipse cx="113" cy="57" rx="5" ry="7" fill="#ddb28b"/><path d="m113 55-1 5 3 1" fill="none" stroke="#ad7956" stroke-width="1.5"/>
      <path d="m130 48 9 1" stroke="#5e4434" stroke-width="2.2" stroke-linecap="round"/><ellipse cx="135" cy="54" rx="1.8" ry="2" fill="#2f3031"/><circle cx="135.5" cy="53.4" r=".5" fill="#f6e5c8"/>
      <path d="m139 56 3 8-5 1m-6 8 8-1" fill="none" stroke="#926447" stroke-width="1.5" stroke-linecap="round"/>
      <path d="m119 70 6 8 13-1" fill="none" stroke="#7a5740" stroke-width="2" opacity=".6"/>
      <path d="m96 33 8-22q18-8 32 2l5 25Z" fill="#b89563"/>
      <path d="m106 14 6 12 14-1 9-10q-14-8-29-1Z" fill="#d8b681"/>
      <path d="m99 27 39 3 3 9-45-4Z" fill="#635040"/>
      <path d="M80 36q18-10 67 2l15 7q-5 7-25 4l-52-3q-13-4-5-10Z" fill="#d8b784"/>
      <path d="M83 43q31-7 69 3" fill="none" stroke="#9c7954" stroke-width="2"/>
      <path d="m105 47 1 22 10 13" fill="none" stroke="#79624a" stroke-width="1.4"/>
    </g>
  </svg>`;
}

function desertLandscape() {
  return `<svg class="desert-landscape" viewBox="0 0 640 400" preserveAspectRatio="none" aria-hidden="true">
    <path d="m0 208 51-16 37-34 23 12 35-16 42 44 47-13 36 19 38-37 38 8 32-27 44 14 37 37 37-11 35 26 47-25 39 26 32-8v193H0Z" fill="#7e7977" opacity=".8"/>
    <path d="M0 251q125-98 278-39 117 45 209-13 77-48 153-24v225H0Z" fill="#b48d6c"/>
    <path d="M0 251q125-98 278-39 117 45 209-13-103 75-215 32Q132 176 0 274Z" fill="#d0aa7b"/>
    <path d="M0 282q144 39 307-30 187-78 333 22v126H0Z" fill="#947052"/>
    <path d="M155 300q99-16 152-48 160-70 280-4-146-42-264 12-65 32-168 40Z" fill="#c19a70"/>
    <path d="M0 337q130-58 304-16 193 49 336-22v101H0Z" fill="#665242"/>
    <path d="M253 400q97-57 259-91 61-12 81-40-13 33-77 48-151 45-205 83Z" fill="#c4a17b" opacity=".55"/>
    <path d="m68 343 7-26 5 28m-8-14-9-7m17 13 8-11m472-18 3-21 5 22m-5-10 8-10" fill="none" stroke="#3f443b" stroke-width="3" stroke-linecap="round"/>
    <path d="m35 365 16-8 14 5-4 7-22 2m483-41 11-5 13 4-2 7-19 1" fill="#494539"/>
    <path d="m95 375 13-3m10 8 12-3m11 8 11-3m15 7 11-3m15 7 10-3" stroke="#403f36" stroke-width="4" stroke-linecap="round" opacity=".6"/>
    <path d="m25 301 27 3m-16-9 17 2m460-50 28-5m-23 12 18-4" fill="none" stroke="#e0bd8a" stroke-width="1.2" opacity=".5"/>
  </svg>`;
}

function seedState() {
  return {
    name: 'Артём',
    habits: [
      { id: 'read', name: 'Читать 20 минут', icon: 'book', color: 'blue', weeklyCount: 7, done: true, skipped: false, streak: 12 },
      { id: 'run', name: 'Пробежка', icon: 'run', color: 'green', weeklyCount: 3, done: false, skipped: false, streak: 4 },
      { id: 'sleep', name: 'Ложиться до 00:00', icon: 'moon', color: 'plum', weeklyCount: 7, done: true, skipped: false, streak: 6 },
    ],
    marathon: { name: 'Форма', steps: 28, progress: 9 },
    reduceMotion: false,
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.habits) || !saved.marathon) return seedState();
    return saved;
  } catch { return seedState(); }
}

let state = loadState();
let activeTab = new URLSearchParams(location.search).get('screen') || 'today';
if (!TABS.some(([id]) => id === activeTab)) activeTab = 'today';
let draft = { type: 'promise', name: '', icon: 'book', color: 'blue', weeklyCount: 7, steps: 28 };
let selectedHabitId = null;
let toastTimer = null;

const app = document.getElementById('app');
const content = document.getElementById('content');
const header = document.getElementById('app-header');
const nav = document.getElementById('bottom-nav');
const detailDialog = document.getElementById('detail-dialog');
const confirmDialog = document.getElementById('confirm-dialog');
const celebrationDialog = document.getElementById('celebration-dialog');

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { showToast('Не удалось сохранить данные в браузере'); }
}

function showToast(message) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('visible'), 2700);
}

function dateLabel() {
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
}

function counts() {
  return { done: state.habits.filter(habit => habit.done).length, total: state.habits.length };
}

function scene(large = false) {
  const fraction = Math.min(1, Math.max(0, Number(state.marathon.progress) / Number(state.marathon.steps) || 0));
  const shortStep = Math.round(fraction * 120);
  const longStep = Math.round(fraction * 80);
  return `<div class="scene ${large ? 'scene-large' : ''}" style="--walk-x:${shortStep}px;--walk-x-large:${longStep}px"><div class="scene-sun" aria-hidden="true"></div>${desertLandscape()}<div class="scene-flag">${state.marathon.steps}</div><div class="scene-character">${traveler()}</div></div>`;
}

function marathonCard() {
  const marathon = state.marathon;
  const percent = Math.min(100, Math.round(marathon.progress / marathon.steps * 100));
  return `<a class="marathon-card" href="?screen=marathon" data-tab="marathon" aria-label="Открыть марафон ${escapeHtml(marathon.name)}, шаг ${marathon.progress} из ${marathon.steps}">
    <div class="marathon-card-top"><span>МАРАФОН · ШАГ ${marathon.progress} ИЗ ${marathon.steps}</span>${icon('arrow')}</div>
    ${scene()}
    <div class="marathon-card-bottom"><div><strong>${escapeHtml(marathon.name)}</strong><small>Следующий шаг сегодня</small></div><div class="progress-line" aria-label="Пройдено ${percent}%"><span style="transform:scaleX(${percent / 100})"></span></div></div>
  </a>`;
}

function habitCard(habit) {
  const color = COLORS[habit.color] || COLORS.blue;
  const status = habit.skipped ? 'Пропуск · серия сохранена' : habit.done ? `Серия ${daysLabel(habit.streak)}` : habit.weeklyCount === 7 ? `Серия ${daysLabel(habit.streak)}` : `${timesLabel(habit.weeklyCount)} в неделю`;
  const action = habit.done ? 'Уже выполнено' : habit.skipped ? 'Сегодня пропущено' : `Выполнить: ${habit.name}`;
  return `<article class="habit-card" style="--habit-bg:${color.value};--habit-icon:${color.icon}">
    <button type="button" class="habit-open" data-detail="${escapeHtml(habit.id)}" aria-label="Открыть обещание ${escapeHtml(habit.name)}">
      <span class="habit-icon">${icon(ICONS[habit.icon] || 'book')}</span>
      <span class="habit-copy"><strong>${escapeHtml(habit.name)}</strong><small>${escapeHtml(status)}</small></span>
    </button>
    <button type="button" class="done-button ${habit.done ? 'is-done' : ''} ${habit.skipped ? 'is-skipped' : ''}" data-complete="${escapeHtml(habit.id)}" aria-label="${escapeHtml(action)}" ${habit.done || habit.skipped ? 'disabled' : ''}>${habit.done ? icon('check') : habit.skipped ? icon('pause') : ''}</button>
  </article>`;
}

function renderToday() {
  const { done, total } = counts();
  return `<section class="today-hero"><div><h1>Сегодня ты<br>держишь слово.</h1></div><div class="today-count"><strong>${done}/${total}</strong><span>готово</span></div></section>
    ${marathonCard()}
    <div class="section-title"><h2>Обещания</h2><span>Сегодня</span></div>
    <div class="habits">${state.habits.length ? state.habits.map(habitCard).join('') : `<div class="empty-state"><h3>Первое обещание ждёт тебя</h3><p>Выбери небольшое действие, которое сможешь повторять.</p><a class="button-primary" href="?screen=create" data-tab="create">Создать обещание</a></div>`}</div>
    <a class="quiet-add" href="?screen=create" data-tab="create">${icon('plus')} Новое обещание</a>`;
}

function renderMarathon() {
  const m = state.marathon;
  const percent = Math.round(m.progress / m.steps * 100);
  return `<section class="marathon-page"><div class="page-heading"><span class="eyebrow">ПУСТЫННЫЙ МАРШРУТ</span><h1>${escapeHtml(m.name)}</h1><p>Твой путешественник идёт вперёд с каждым выполненным обещанием.</p></div>
    <div class="marathon-stage">${scene(true)}<div class="stage-meta"><div><span>ПРОЙДЕНО</span><strong>${m.progress} <i>/ ${m.steps}</i></strong></div><div class="stage-percent">${percent}%</div></div></div>
    <div class="timeline"><div class="timeline-line"><span style="transform:scaleX(${percent / 100})"></span></div><div class="timeline-labels"><span>Старт</span><span>Половина</span><span>Финиш</span></div></div>
    <div class="marathon-note">${icon('spark')}<p>Выполни обещание сегодня. После отметки персонаж сделает шаг на весь экран.</p></div>
    <a class="button-primary" href="?screen=today" data-tab="today">К обещаниям ${icon('arrow')}</a></section>`;
}

function renderCreate() {
  const promise = draft.type === 'promise';
  const color = COLORS[draft.color] || COLORS.blue;
  return `<section class="create-page"><div class="page-heading"><span class="eyebrow">НОВОЕ</span><h1>Дай себе слово.</h1><p>Начни с одного понятного действия.</p></div>
    <div class="type-switch" role="group" aria-label="Что создать"><button type="button" data-draft-type="promise" aria-pressed="${promise}">Обещание</button><button type="button" data-draft-type="marathon" aria-pressed="${!promise}">Марафон</button></div>
    <form id="create-form">
      <label class="field-label" for="create-name">Название</label><input id="create-name" name="name" maxlength="48" autocomplete="off" placeholder="Например, читать 20 минут…" value="${escapeHtml(draft.name)}" required>
      ${promise ? `<fieldset class="choice-field"><legend>Иконка</legend><div class="icon-choices">${Object.keys(ICONS).map(key => `<button type="button" class="icon-choice" data-draft-icon="${key}" aria-label="${{book:'Книга',run:'Бег',moon:'Сон'}[key]}" aria-pressed="${draft.icon === key}">${icon(key)}</button>`).join('')}</div></fieldset>
      <fieldset class="choice-field"><legend>Акцент карточки</legend><div class="color-choices">${Object.entries(COLORS).map(([key, entry]) => `<button type="button" class="color-choice" style="--choice:${entry.icon}" data-draft-color="${key}" aria-label="${entry.name}" aria-pressed="${draft.color === key}"></button>`).join('')}</div></fieldset>
      <fieldset class="choice-field"><legend>Сколько дней в неделю</legend><div class="week-choices">${[1,2,3,4,5,6,7].map(n => `<button type="button" data-draft-week="${n}" aria-pressed="${draft.weeklyCount === n}">${n}</button>`).join('')}</div></fieldset>
      <div class="preview-label">Как будет выглядеть</div><div class="habit-card preview-card" style="--habit-bg:${color.value};--habit-icon:${color.icon}"><span class="habit-icon">${icon(ICONS[draft.icon])}</span><span class="habit-copy"><strong id="preview-name">${escapeHtml(draft.name || 'Новое обещание')}</strong><small>${draft.weeklyCount === 7 ? 'Каждый день' : `${daysLabel(draft.weeklyCount)} в неделю`}</small></span><span class="done-button"></span></div>` : `<fieldset class="choice-field"><legend>Длительность</legend><div class="duration-choices">${[7,14,28].map(n => `<button type="button" data-draft-steps="${n}" aria-pressed="${draft.steps === n}">${n} дней</button>`).join('')}</div></fieldset><p class="form-note">Марафон создаётся отдельно от обещаний. Его шаги зависят от выполненных обещаний.</p>`}
      <button type="submit" class="button-primary submit-create">${promise ? 'Создать обещание' : 'Начать марафон'} ${icon('arrow')}</button>
    </form></section>`;
}

function renderFriends() {
  return `<section class="friends-page"><div class="page-heading"><span class="eyebrow">РЯДОМ</span><h1>Друзья</h1><p>Свои обещания легче держать, когда видишь, как идут другие.</p></div>
    <article class="friend-card"><div class="friend-avatar avatar-peach">М</div><div><strong>Маша</strong><span>Сегодня выполнено 3 из 4</span></div><div class="friend-ring">3/4</div></article>
    <article class="friend-card"><div class="friend-avatar avatar-blue">Н</div><div><strong>Никита</strong><span>Марафон: день 12 из 28</span></div><div class="friend-ring">12</div></article>
    <div class="friends-share"><h2>Пригласи друга</h2><p>Отправь ссылку на Disbit, чтобы идти к цели вместе.</p><button type="button" class="button-primary" id="share-app">${icon('share')} Поделиться ссылкой</button></div></section>`;
}

function renderProfile() {
  const completed = state.habits.filter(h => h.done).length;
  return `<section class="profile-page"><div class="profile-hero"><div class="profile-avatar">${avatar()}</div><span>ПРОФИЛЬ</span><h1>${escapeHtml(state.name)}</h1><p>Каждый шаг считается.</p></div>
    <div class="profile-metrics"><div><strong>${completed}</strong><span>выполнено сегодня</span></div><div><strong>${state.marathon.progress}</strong><span>шагов марафона</span></div></div>
    <form id="profile-form" class="profile-form"><label class="field-label" for="profile-name">Имя в приложении</label><div class="profile-edit"><input id="profile-name" name="name" value="${escapeHtml(state.name)}" maxlength="24" autocomplete="nickname" required><button type="submit">Сохранить</button></div></form>
    <div class="setting-row"><div><strong>Сократить движение</strong><span>Оставить спокойные смены состояний</span></div><button type="button" id="motion-toggle" role="switch" aria-checked="${state.reduceMotion}" aria-label="Сократить движение"><i></i></button></div>
    </section>`;
}

function render() {
  app.dataset.motion = state.reduceMotion ? 'reduced' : 'normal';
  document.documentElement.dataset.motion = app.dataset.motion;
  header.innerHTML = `<div class="header-brand"><div class="wordmark" translate="no">disbit<span>.</span></div><span>${escapeHtml(dateLabel())}</span></div><a class="avatar-button" href="?screen=profile" data-tab="profile" aria-label="Открыть профиль">${avatar()}</a>`;
  nav.innerHTML = TABS.map(([id, label, glyph]) => `<a class="nav-item ${id === 'create' ? 'nav-create' : ''}" href="?screen=${id}" data-tab="${id}" aria-label="${label}" ${id === activeTab ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span></a>`).join('');
  content.innerHTML = ({ today: renderToday, marathon: renderMarathon, create: renderCreate, friends: renderFriends, profile: renderProfile })[activeTab]();
}

function navigate(tab) {
  if (!TABS.some(([id]) => id === tab)) return;
  activeTab = tab;
  const url = new URL(location.href);
  url.searchParams.set('screen', tab);
  history.pushState({ tab }, '', url);
  render();
  content.scrollTop = 0;
}

function habitById(id) { return state.habits.find(habit => habit.id === id); }

function completeHabit(id) {
  const habit = habitById(id);
  if (!habit || habit.done || habit.skipped) return;
  const previous = state.marathon.progress;
  habit.done = true;
  habit.streak += 1;
  state.marathon.progress = Math.min(state.marathon.steps, previous + 1);
  save();
  render();
  showCelebration(habit.name, previous, state.marathon.progress);
}

function showCelebration(name, previous, next) {
  const total = state.marathon.steps;
  document.getElementById('celebration-content').innerHTML = `<div class="celebration-top"><span>ОБЕЩАНИЕ ВЫПОЛНЕНО</span><button type="button" class="icon-button" data-close-dialog="celebration-dialog" aria-label="Закрыть">${icon('close')}</button></div>
    <div class="celebration-scene">${scene(true)}<div class="celebration-character">${traveler()}</div></div>
    <div class="celebration-copy"><span class="eyebrow">${escapeHtml(name)}</span><h2 id="celebration-title">${next >= total ? 'Финиш!' : 'Ещё один шаг.'}</h2><p>${next >= total ? 'Ты дошёл до конца марафона.' : 'Твой путешественник стал ближе к цели.'}</p><div class="celebration-progress"><span>Было ${previous} / ${total}</span><strong>Стало ${next} / ${total}</strong></div></div>
    <div class="celebration-actions"><button type="button" class="button-secondary" id="share-completion">${icon('share')} Поделиться</button><button type="button" class="button-primary" data-close-dialog="celebration-dialog">Продолжить ${icon('arrow')}</button></div>`;
  celebrationDialog.showModal();
  if (state.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  requestAnimationFrame(() => celebrationDialog.classList.add('walking'));
}

function openDetail(id) {
  const habit = habitById(id);
  if (!habit) return;
  selectedHabitId = id;
  const color = COLORS[habit.color] || COLORS.blue;
  document.getElementById('detail-content').innerHTML = `<div class="dialog-top"><div class="detail-heading"><span class="habit-icon" style="--habit-bg:${color.value};--habit-icon:${color.icon}">${icon(ICONS[habit.icon] || 'book')}</span><h2 id="detail-title">${escapeHtml(habit.name)}</h2></div><button type="button" class="icon-button" data-close-dialog="detail-dialog" aria-label="Закрыть">${icon('close')}</button></div>
    <div class="detail-stats"><div><strong>${daysLabel(habit.streak)}</strong><span>текущая серия</span></div><div><strong>${daysLabel(habit.weeklyCount)}</strong><span>в неделю</span></div></div>
    <p class="detail-status">${habit.skipped ? 'Сегодня пропуск. Серия сохранена.' : habit.done ? 'Сегодня выполнено. Отмена недоступна случайным нажатием.' : 'На сегодня ещё не выполнено.'}</p>
    <div class="detail-actions"><button type="button" class="button-secondary" data-share-habit="${escapeHtml(id)}">${icon('share')} Поделиться</button>${!habit.done && !habit.skipped ? `<button type="button" class="button-secondary" data-skip-habit="${escapeHtml(id)}">${icon('pause')} Пропустить сегодня</button>` : ''}<button type="button" class="button-danger-outline" data-delete-habit="${escapeHtml(id)}">${icon('trash')} Удалить обещание</button></div>`;
  detailDialog.showModal();
}

async function shareText(title, text) {
  const payload = { title, text, url: 'https://disbit.ru' };
  try {
    if (navigator.share) { await navigator.share(payload); return; }
    if (navigator.clipboard) { await navigator.clipboard.writeText(`${text} https://disbit.ru`); showToast('Текст скопирован'); return; }
    showToast('Поделиться можно из поддерживаемого браузера');
  } catch (error) {
    if (error.name !== 'AbortError') showToast('Не удалось поделиться');
  }
}

document.addEventListener('click', event => {
  const tab = event.target.closest('[data-tab]');
  if (tab) {
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
      event.preventDefault();
      navigate(tab.dataset.tab);
    }
    return;
  }
  const done = event.target.closest('[data-complete]');
  if (done) { completeHabit(done.dataset.complete); return; }
  const detail = event.target.closest('[data-detail]');
  if (detail) { openDetail(detail.dataset.detail); return; }
  const close = event.target.closest('[data-close-dialog]');
  if (close) { document.getElementById(close.dataset.closeDialog).close(); return; }
  const skip = event.target.closest('[data-skip-habit]');
  if (skip) { const habit = habitById(skip.dataset.skipHabit); if (habit && !habit.done) { habit.skipped = true; save(); detailDialog.close(); render(); showToast('Пропуск отмечен, серия сохранена'); } return; }
  const remove = event.target.closest('[data-delete-habit]');
  if (remove) { selectedHabitId = remove.dataset.deleteHabit; const habit = habitById(selectedHabitId); detailDialog.close(); document.getElementById('confirm-text').textContent = `«${habit?.name || 'Обещание'}» исчезнет из списка. Это действие нельзя отменить.`; confirmDialog.showModal(); return; }
  const shareHabit = event.target.closest('[data-share-habit]');
  if (shareHabit) { const habit = habitById(shareHabit.dataset.shareHabit); if (habit) shareText('Моё обещание', `Я держу обещание: ${habit.name}.`); return; }
  const draftType = event.target.closest('[data-draft-type]');
  if (draftType) { draft.type = draftType.dataset.draftType; render(); return; }
  const draftIcon = event.target.closest('[data-draft-icon]');
  if (draftIcon) { draft.icon = draftIcon.dataset.draftIcon; render(); return; }
  const draftColor = event.target.closest('[data-draft-color]');
  if (draftColor) { draft.color = draftColor.dataset.draftColor; render(); return; }
  const draftWeek = event.target.closest('[data-draft-week]');
  if (draftWeek) { draft.weeklyCount = Number(draftWeek.dataset.draftWeek); render(); return; }
  const draftSteps = event.target.closest('[data-draft-steps]');
  if (draftSteps) { draft.steps = Number(draftSteps.dataset.draftSteps); render(); return; }
  if (event.target.closest('#share-app')) { shareText('Disbit', 'Попробуй Disbit: приложение для обещаний себе.'); return; }
  if (event.target.closest('#share-completion')) { shareText('Обещание выполнено', 'Я выполнил обещание и сделал ещё один шаг в Disbit.'); return; }
  if (event.target.closest('#motion-toggle')) { state.reduceMotion = !state.reduceMotion; save(); render(); showToast(state.reduceMotion ? 'Движение сокращено' : 'Движение включено'); }
});

document.getElementById('confirm-delete').addEventListener('click', () => {
  state.habits = state.habits.filter(habit => habit.id !== selectedHabitId);
  selectedHabitId = null;
  save();
  confirmDialog.close();
  render();
  showToast('Обещание удалено');
});

content.addEventListener('input', event => {
  if (event.target.id === 'create-name') {
    draft.name = event.target.value;
    const preview = document.getElementById('preview-name');
    if (preview) preview.textContent = draft.name || 'Новое обещание';
  }
});

content.addEventListener('submit', event => {
  if (event.target.id === 'create-form') {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) { event.target.querySelector('#create-name').reportValidity(); return; }
    if (draft.type === 'promise') {
      state.habits.push({ id: crypto.randomUUID?.() || `promise-${Date.now()}`, name, icon: draft.icon, color: draft.color, weeklyCount: draft.weeklyCount, done: false, skipped: false, streak: 0 });
      draft = { type: 'promise', name: '', icon: 'book', color: 'blue', weeklyCount: 7, steps: 28 };
      save();
      navigate('today');
      showToast('Обещание создано');
    } else {
      if (state.marathon.progress > 0 && !confirm('Новый марафон заменит текущий путь. Продолжить?')) return;
      state.marathon = { name, steps: draft.steps, progress: 0 };
      draft = { type: 'promise', name: '', icon: 'book', color: 'blue', weeklyCount: 7, steps: 28 };
      save();
      navigate('marathon');
      showToast('Марафон начат');
    }
  }
  if (event.target.id === 'profile-form') {
    event.preventDefault();
    const name = event.target.elements.name.value.trim();
    if (!name) { event.target.elements.name.reportValidity(); return; }
    state.name = name;
    save();
    render();
    showToast('Имя сохранено');
  }
});

celebrationDialog.addEventListener('close', () => celebrationDialog.classList.remove('walking'));
for (const dialog of [detailDialog, confirmDialog, celebrationDialog]) {
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
}
window.addEventListener('popstate', () => {
  activeTab = new URLSearchParams(location.search).get('screen') || 'today';
  if (!TABS.some(([id]) => id === activeTab)) activeTab = 'today';
  render();
});

render();
