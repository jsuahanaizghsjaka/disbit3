const icon = (name, className = '') => `<svg class="glyph ${className}" aria-hidden="true"><use href="#ic-${name}"></use></svg>`;

function portrait(kind) {
  const horns = kind === 'tricer' ? '<path d="M14 17 7 4l15 8M35 15l7-11 2 17" fill="var(--portrait-horn)"/>'
    : kind === 'stego' ? '<path d="m9 20 3-11 8 7 3-12 8 11 8-6 2 12" fill="var(--portrait-horn)"/>'
    : kind === 'para' ? '<path d="M25 14Q29 0 42 4 36 9 36 19" fill="var(--portrait-horn)"/>'
    : '<path d="M10 15Q12 6 19 10M34 11Q39 7 42 15" fill="var(--portrait-horn)"/>';
  return `<span class="portrait" aria-label="Аватар динозавра"><svg viewBox="0 0 52 52" aria-hidden="true">${horns}<path d="M9 31Q9 16 25 14q17-2 19 17l-7 15H16Z" fill="var(--portrait-body)"/><path d="M31 20q10 2 12 12l-7 5-13-4Z" fill="var(--portrait-light)"/><circle cx="31" cy="26" r="2" fill="var(--portrait-eye)"/><circle cx="31.7" cy="25.3" r=".6" fill="white"/><path d="M34 34q3 3 7 0" fill="none" stroke="var(--portrait-eye)" stroke-width="1.5" stroke-linecap="round"/></svg></span>`;
}

function dino(kind) {
  const commonStart = '<svg class="dino" viewBox="0 0 240 180" role="img" aria-label="Персонаж динозавр в марафоне"><ellipse cx="122" cy="158" rx="82" ry="8" fill="var(--d-shadow)" opacity=".33"/>';
  const commonEnd = '</svg>';
  const art = {
    raptor: `<path d="M93 104Q50 67 18 79q30 5 53 39l24 8Z" fill="var(--d-dark)"/>
      <path d="M109 123q-10 25-2 31h27q-17-8-6-28M148 121q-3 27 10 33h25q-19-5-17-28" fill="var(--d-dark)"/>
      <ellipse cx="122" cy="104" rx="55" ry="39" fill="var(--d-body)"/>
      <path d="M104 71q20-24 44-20l12 28q-19 17-51 12" fill="var(--d-body)"/>
      <path d="M141 51q27-15 45-3 9 6 8 20l16 7q2 10-18 15h-33q-28-9-18-39Z" fill="var(--d-body)"/>
      <path d="M176 68q23-4 34 7-4 9-22 11h-23" fill="var(--d-light)"/>
      <path d="M110 98q19 20 46 21-18 16-43 15-30-3-36-21" fill="var(--d-light)"/>
      <path d="m150 97 13 11 13-2" fill="none" stroke="var(--d-dark)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M149 78q18 9 35 3" fill="none" stroke="var(--d-accent)" stroke-width="7" stroke-linecap="round"/>
      <path d="m155 82-6 23 16-13" fill="var(--d-accent)"/>
      <circle cx="174" cy="59" r="3.4" fill="var(--d-ink)"/><circle cx="175" cy="58" r=".9" fill="#fff"/>
      <path d="M183 79q7 4 13-1" fill="none" stroke="var(--d-ink)" stroke-width="1.7" stroke-linecap="round"/>
      <path d="M104 152h28m27 1h25" stroke="var(--d-ink)" stroke-width="3" stroke-linecap="round"/>`,
    stego: `<path d="M92 108Q50 84 20 105q24 3 59 23" fill="var(--d-dark)"/>
      <path d="m70 92 2-35 20 27 12-42 21 32 17-43 20 46 19-34 9 51" fill="var(--d-accent)" stroke="var(--d-dark)" stroke-width="3" stroke-linejoin="round"/>
      <path d="M79 120v33h22l4-23m31-5v28h24l4-31" fill="var(--d-dark)"/>
      <ellipse cx="125" cy="103" rx="68" ry="43" fill="var(--d-body)"/>
      <path d="M159 84q23-21 44-6l17 16q1 27-25 30l-32-11" fill="var(--d-body)"/>
      <path d="M103 113q27 17 58 9-21 23-51 14-15-4-27-18" fill="var(--d-light)"/>
      <path d="M178 98q20 8 37-1" fill="none" stroke="var(--d-light)" stroke-width="7" stroke-linecap="round"/>
      <circle cx="195" cy="87" r="3.2" fill="var(--d-ink)"/><circle cx="196" cy="86" r=".8" fill="#fff"/>
      <path d="M205 108q5 3 9-1" fill="none" stroke="var(--d-ink)" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M82 153h20m34 0h25" stroke="var(--d-ink)" stroke-width="3" stroke-linecap="round"/>`,
    tricer: `<path d="M81 113Q47 82 24 91q13 16 54 36" fill="var(--d-dark)"/>
      <path d="M91 125v29h24l3-22m37-4v26h24l2-24" fill="var(--d-dark)"/>
      <ellipse cx="122" cy="105" rx="59" ry="41" fill="var(--d-body)"/>
      <path d="M145 69q-4-40 33-37 21 2 30 24l-1 30-37 22Z" fill="var(--d-dark)"/>
      <path d="M151 67q5-27 28-26 21 2 25 24l-20 25Z" fill="var(--d-accent)"/>
      <path d="M160 76q17-8 38-3l16 17-4 26q-16 21-40 7-17-10-10-47" fill="var(--d-body)"/>
      <path d="m163 75-10-32 21 19M194 72l4-29 11 37m-4 21 22-3-16 11" fill="var(--d-light)" stroke="var(--d-dark)" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M106 117q24 13 47 4-13 16-36 16-20 0-33-16" fill="var(--d-light)"/>
      <circle cx="185" cy="89" r="3.4" fill="var(--d-ink)"/><circle cx="186" cy="88" r=".8" fill="#fff"/>
      <path d="M199 111q5 3 9-1" fill="none" stroke="var(--d-ink)" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M93 154h22m40 0h25" stroke="var(--d-ink)" stroke-width="3" stroke-linecap="round"/>`,
    ankylo: `<path d="M84 112Q49 113 24 94q-2 12 27 30l-10 12q-10 13 2 17 18 3 27-13l17-9" fill="var(--d-dark)"/>
      <path d="M81 124v27h23l4-20m36-4v24h25l4-22" fill="var(--d-dark)"/>
      <ellipse cx="122" cy="106" rx="66" ry="43" fill="var(--d-body)"/>
      <path d="M69 94q15-43 60-43 43 0 57 41-45 23-117 2Z" fill="var(--d-dark)"/>
      <path d="M75 89q17-32 55-32 36 0 50 31-45 16-105 1Z" fill="var(--d-accent)"/>
      <path d="M97 66v31m28-39v43m29-35-1 31M80 87q49 15 98-1" stroke="var(--d-dark)" opacity=".35" stroke-width="3" fill="none"/>
      <path d="M171 97q24-23 46-8l7 20q-6 22-34 21l-23-13" fill="var(--d-body)"/>
      <path d="M179 111q19 5 39-3" stroke="var(--d-light)" stroke-width="7" fill="none" stroke-linecap="round"/>
      <circle cx="201" cy="97" r="3.1" fill="var(--d-ink)"/><circle cx="202" cy="96" r=".8" fill="#fff"/>
      <path d="M86 151h18m43 0h23" stroke="var(--d-ink)" stroke-width="3" stroke-linecap="round"/>`,
    para: `<path d="M104 116Q64 87 24 93q30 7 63 36" fill="var(--d-dark)"/>
      <path d="M103 121v32h25l2-23m28-4v27h25l1-26" fill="var(--d-dark)"/>
      <ellipse cx="120" cy="106" rx="57" ry="40" fill="var(--d-body)"/>
      <path d="M139 89q3-35 21-57l22 7q-13 28-12 59" fill="var(--d-body)"/>
      <path d="M159 37q-8-27 8-30 17-2 28 19-18-7-25 22" fill="var(--d-accent)" stroke="var(--d-dark)" stroke-width="3"/>
      <path d="M165 35q25-10 42 3 8 7 4 22l-28 13-22-10Z" fill="var(--d-body)"/>
      <path d="M187 59q22-10 30-2-5 12-27 17l-15-9" fill="var(--d-light)"/>
      <path d="M106 118q23 15 47 3-15 16-39 15-17-1-29-17" fill="var(--d-light)"/>
      <circle cx="189" cy="47" r="3.2" fill="var(--d-ink)"/><circle cx="190" cy="46" r=".8" fill="#fff"/>
      <path d="M103 153h25m31 0h24" stroke="var(--d-ink)" stroke-width="3" stroke-linecap="round"/>`
  };
  return commonStart + art[kind] + commonEnd;
}

const mini = (name, className = '') => `<span class="mini-icon ${className}">${icon(name)}</span>`;
const mark = (done = false) => `<span class="done-mark ${done ? 'is-done' : ''}">${done ? icon('check') : ''}</span>`;

function dock(active, labels = ['Сегодня', 'Марафон', 'Создать', 'Друзья', 'Профиль']) {
  const icons = ['home', 'map', 'plus', 'friends', 'user'];
  return `<nav class="dock" aria-label="Разделы приложения">${labels.map((label, i) => `<div class="dock-item ${i === active ? 'active' : ''} ${i === 2 ? 'dock-create' : ''}">${icon(icons[i])}<span>${label}</span></div>`).join('')}</nav>`;
}

function phone(body, active = 0, labels) {
  return `<div class="status-bar"><span>9:41</span><span class="signal"><i></i><i></i><i></i><i></i><b></b></span></div><div class="screen-body">${body}</div>${dock(active, labels)}`;
}

const variants = [
  {
    name: 'Путь', number: '01', label: 'Марафон впереди',
    intro: 'Экран сразу показывает, куда движется персонаж. Обещания остаются коротким списком ежедневных действий.',
    strengths: 'Хорош для сильной игровой стороны Disbit. Путь виден до первого нажатия.',
    cost: 'Большая сцена оставляет меньше места списку, если обещаний много.',
    colors: [['Фон', '#0B1324'], ['Карточка', '#17243B'], ['Кнопка', '#6689DB'], ['Текст', '#F3F5FB']],
    sizes: [['Основная', '358 × 54'], ['Выполнить', '52 × 52'], ['Карточка', '358 × 74'], ['Меню (высота)', '72']],
    avatar: 'Раптор «Темп»: большой бегущий персонаж в сцене и простая голова в профиле.',
    render: () => phone(`<div class="v1-head"><div><div class="wordmark">dis<span>bit</span></div><span class="micro">ВТОРНИК, 6 ОКТЯБРЯ</span></div>${portrait('raptor')}</div>
      <div class="v1-greeting"><h2>Сегодня ты<br>держишь слово.</h2><div class="v1-counter"><b>2/3</b><span>готово</span></div></div>
      <section class="v1-marathon"><div class="v1-card-top"><span>МАРАФОН · ДЕНЬ 9 ИЗ 28</span>${icon('arrow')}</div><div class="v1-scene"><div class="v1-hill back"></div><div class="v1-hill front"></div><div class="v1-path"></div><span class="v1-flag">28</span>${dino('raptor')}</div><div class="v1-card-bottom"><div><strong>Форма</strong><small>Следующий шаг сегодня</small></div><div class="v1-track"><i></i></div></div></section>
      <div class="section-heading"><h3>Обещания</h3><span>Сегодня</span></div>
      <div class="v1-task task-book">${mini('book')}<div><b>Читать 20 минут</b><small>${icon('fire')} 12 дней подряд</small></div>${mark(true)}</div>
      <div class="v1-task task-run">${mini('run')}<div><b>Пробежка</b><small>Ещё 1 раз на неделе</small></div>${mark()}</div>
      <div class="v1-task task-moon">${mini('moon')}<div><b>Ложиться до 00:00</b><small>Сегодня до полуночи</small></div>${mark()}</div>`, 0),
  },
  {
    name: 'Клуб', number: '02', label: 'Неделя впереди',
    intro: 'Главным становится недельный ритм. Марафон выглядит как карточка участника клуба, а не как отчётный график.',
    strengths: 'Быстрее считывается план недели. Подходит тем, кто открывает приложение несколько раз в день.',
    cost: 'Волшебство персонажа заметно меньше, чем в «Пути».',
    colors: [['Фон', '#EFF3F4'], ['Карточка', '#FFFFFF'], ['Кнопка', '#236F5D'], ['Текст', '#18352F']],
    sizes: [['Основная', '358 × 52'], ['Выполнить', '52 × 52'], ['Карточка', '358 × 77'], ['Меню (высота)', '74']],
    avatar: 'Стегозавр «Ритм»: плоский знак в шапке и персонаж с рюкзаком на клубной карточке.',
    render: () => phone(`<div class="v2-head"><div class="v2-brand">disbit <span>КЛУБ</span></div>${portrait('stego')}</div>
      <div class="v2-title"><span>6 октября · вторник</span><h2>Хороший темп,<br>Артём.</h2></div>
      <div class="v2-week"><div class="v2-week-top"><strong>Эта неделя</strong><span>14 из 18</span></div><div class="week-days">${[['Пн','✓'],['Вт','✓'],['Ср','✓'],['Чт','✓'],['Пт','•'],['Сб',''],['Вс','']].map(([d,n],i)=>`<div class="${i===4?'today':''}"><small>${d}</small><b>${n}</b></div>`).join('')}</div></div>
      <div class="v2-section"><h3>На сегодня</h3><span>2 осталось</span></div>
      <div class="v2-promise"><div class="v2-stripe"></div>${mini('book')}<div><b>Читать 20 минут</b><small>Серия 12 дней</small></div>${mark(true)}</div>
      <div class="v2-promise"><div class="v2-stripe"></div>${mini('run')}<div><b>Пробежка</b><small>Последний раз на неделе</small></div>${mark()}</div>
      <section class="v2-marathon"><div><div class="v2-badge">КАРТА УЧАСТНИКА · 09 / 28</div><strong>Сильное утро</strong><small>Идём дальше</small></div>${dino('stego')}</section>`, 0, ['Сегодня', 'Марафон', 'Создать', 'Друзья', 'Я']),
  },
  {
    name: 'Объекты', number: '03', label: 'Действие впереди',
    intro: 'Каждое обещание ощущается отдельным предметом: цвет, вес, рельеф. На экране мало текста и крупные действия.',
    strengths: 'Самый узнаваемый и игровой характер. Цвет выбранной карточки действительно становится частью интерфейса.',
    cost: 'Потребует аккуратной отрисовки всех иконок и состояний.',
    colors: [['Фон', '#1B1E20'], ['Карточка', '#F0F2EE'], ['Кнопка', '#F07856'], ['Текст', '#171B1C']],
    sizes: [['Основная', '358 × 56'], ['Выполнить', '52 × 52'], ['Карточка', '358 × 91'], ['Меню (высота)', '74']],
    avatar: 'Трицератопс «Фокус»: силуэт на маленьком жетоне, большая коллекционная фигурка в марафоне.',
    render: () => phone(`<div class="v3-head"><div class="wordmark">disbit<span>.</span></div>${portrait('tricer')}</div>
      <div class="v3-title"><span>ВТОРНИК / 06.10</span><h2>Держи<br>слово<span>.</span></h2></div>
      <section class="v3-hero"><div class="v3-hero-info"><span>МАРАФОН</span><b>Форма</b><small>9 из 28 шагов</small></div><div class="v3-disc"></div>${dino('tricer')}<div class="v3-hero-arrow">${icon('arrow')}</div></section>
      <div class="v3-ready"><span>На сегодня</span><b>2 <i>/ 3</i></b></div>
      <div class="v3-tile color-peach">${mini('book')}<div><b>Читать 20 минут</b><small>12 дней подряд</small></div>${mark(true)}</div>
      <div class="v3-tile color-mint">${mini('run')}<div><b>Пробежка</b><small>Ещё 1 на неделе</small></div>${mark()}</div>
      <div class="v3-tile color-lilac">${mini('moon')}<div><b>Сон до 00:00</b><small>Сегодня</small></div>${mark()}</div>`, 0, ['Дом', 'Путь', 'Создать', 'Люди', 'Я']),
  },
  {
    name: 'Тихий лес', number: '04', label: 'Атмосфера впереди',
    intro: 'Спокойная лесная сцена превращает марафон в путешествие. Обещания не соревнуются с ней за внимание.',
    strengths: 'Самый мягкий тон для ежедневного использования. Персонаж и его путь запоминаются.',
    cost: 'Нужны качественные сцены для разных марафонов и сезонов.',
    colors: [['Фон', '#142A25'], ['Карточка', '#203A32'], ['Кнопка', '#B7D2A7'], ['Текст', '#F1F3E9']],
    sizes: [['Основная', '358 × 54'], ['Выполнить', '52 × 52'], ['Строка', '358 × 65'], ['Меню (высота)', '72']],
    avatar: 'Анкилозавр «Защита»: спокойный знак в профиле и герой лесного маршрута.',
    render: () => phone(`<div class="v4-top"><div class="v4-topline"><span>disbit</span>${portrait('ankylo')}</div><div class="v4-date">Вторник, 6 октября</div><h2>Ещё один шаг<br>по своему пути.</h2></div>
      <section class="v4-forest"><div class="v4-sun"></div><div class="v4-trees rear"></div><div class="v4-trees front"></div><div class="v4-ground"></div><div class="v4-trail"></div>${dino('ankylo')}<div class="v4-m-card"><span>МАРАФОН · ФОРМА</span><b>День 9 <i>/ 28</i></b></div></section>
      <div class="v4-action">Продолжить путь ${icon('arrow')}</div>
      <div class="v4-list-title"><h3>Сегодня</h3><span>2 из 3</span></div>
      <div class="v4-line">${mini('book')}<div><b>Читать 20 минут</b><small>Серия 12 дней</small></div>${mark(true)}</div>
      <div class="v4-line">${mini('run')}<div><b>Пробежка</b><small>Остался 1 раз</small></div>${mark()}</div>
      <div class="v4-line">${mini('moon')}<div><b>Сон до полуночи</b><small>До 00:00</small></div>${mark()}</div>`, 0, ['Сегодня', 'Путь', 'Создать', 'Друзья', 'Я']),
  },
  {
    name: 'Студия', number: '05', label: 'Ясность впереди',
    intro: 'Светлая модульная композиция. Прогресс, задачи и герой разведены по ясным уровням.',
    strengths: 'Самый быстрый для чтения экран. Хорошо масштабируется, когда обещаний и друзей станет больше.',
    cost: 'Потребует особенно выразительной графики персонажей, чтобы сохранить характер Disbit.',
    colors: [['Фон', '#E9EEF6'], ['Карточка', '#FFFFFF'], ['Кнопка', '#3D62B4'], ['Текст', '#24344D']],
    sizes: [['Основная', '358 × 54'], ['Выполнить', '52 × 52'], ['Карточка', '358 × 76'], ['Меню (высота)', '74']],
    avatar: 'Паразауролоф «Рост»: аккуратный профильный знак и отдельная полноразмерная марафонская фигура.',
    render: () => phone(`<div class="v5-head"><div><span class="v5-logo">disbit</span><small>ВТОРНИК, 6 ОКТЯБРЯ</small></div>${portrait('para')}</div>
      <div class="v5-overview"><div><span>На сегодня</span><h2>2 <i>/ 3</i></h2><small>Один шаг до полного дня</small></div><div class="v5-ring"><span>67%</span></div></div>
      <div class="v5-tabs"><span class="active">Сегодня</span><span>Неделя</span><span>История</span></div>
      <div class="v5-task"><div class="v5-side peach"></div>${mini('book')}<div><b>Читать 20 минут</b><small>Серия 12 дней</small></div>${mark(true)}</div>
      <div class="v5-task"><div class="v5-side blue"></div>${mini('run')}<div><b>Пробежка</b><small>1 из 3 на неделе</small></div>${mark()}</div>
      <section class="v5-marathon"><div class="v5-scene"><span class="v5-orbit"></span>${dino('para')}</div><div class="v5-marathon-copy"><small>МАРАФОН · ДЕНЬ 9</small><b>Форма</b><span>Шаг 9 из 28</span><div>Продолжить ${icon('arrow')}</div></div></section>
      <div class="v5-last">${mini('moon')}<div><b>Сон до полуночи</b><small>Сегодня до 00:00</small></div>${mark()}</div>`, 0),
  },
];

const screen = document.getElementById('phone-screen');
const notes = document.getElementById('concept-notes');
const tabs = [...document.querySelectorAll('.concept-tabs button')];
let active = 0;

function show(index) {
  if (index < 0 || index >= variants.length) return;
  active = index;
  const v = variants[index];
  screen.className = `phone-screen v${index + 1}`;
  screen.innerHTML = v.render();
  screen.querySelector('.screen-body').scrollTop = 0;
  notes.innerHTML = `<div class="notes-number">${v.number} / 05</div><h2>${v.name}</h2><p class="notes-axis">${v.label}</p><p>${v.intro}</p><div class="notes-rule"></div><h3>Цвета</h3><div class="swatches">${v.colors.map(([label, color]) => `<div class="swatch"><i style="background:${color}"></i><span>${label}</span><code>${color}</code></div>`).join('')}</div><h3>Размеры на экране 390 px</h3><div class="size-list">${v.sizes.map(([label, value]) => `<div><span>${label}</span><b>${value} px</b></div>`).join('')}</div><h3>Персонаж</h3><p>${v.avatar}</p><div class="tradeoffs"><div><b>Сильная сторона</b><p>${v.strengths}</p></div><div><b>Компромисс</b><p>${v.cost}</p></div></div><p class="notes-static">Это визуальный макет. Рабочие функции приложения здесь не изменены.</p>`;
  tabs.forEach((tab, i) => {
    const selected = i === index;
    tab.classList.toggle('selected', selected);
    tab.setAttribute('aria-current', selected ? 'true' : 'false');
  });
  const url = new URL(location.href);
  url.searchParams.set('v', String(index + 1));
  history.replaceState(null, '', url);
}

tabs.forEach((tab, i) => tab.addEventListener('click', () => show(i)));
document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (/^[1-5]$/.test(event.key)) show(Number(event.key) - 1);
  else if (event.key === 'ArrowRight') show((active + 1) % variants.length);
  else if (event.key === 'ArrowLeft') show((active + variants.length - 1) % variants.length);
});

const initial = Number(new URLSearchParams(location.search).get('v'));
show(initial >= 1 && initial <= 5 ? initial - 1 : 0);
