/* Адаптер Telegram Mini App (ТЗ docs/TELEGRAM-TZ.md, разделы 4, 5, 9, 10).
   Подключается только на странице /tg/ (её HTML собирает сервер из index.html).
   Порядок: проверка среды → вход по initData → (экран выбора/согласия) → загрузка остальных
   скриптов приложения → привязка кнопок Telegram, темы, ссылок и настроек.
   Токен хранится только в памяти (ТЗ: localStorage на части клиентов очищается). */
(function () {
  'use strict';
  const WA = window.Telegram && window.Telegram.WebApp;
  // ТЗ 10: страница открыта в обычном браузере без initData — на основной сайт.
  if (!WA || !WA.initData) { location.replace('https://disbit.ru/'); return; }

  const SITE = 'https://disbit.ru';
  const TOKEN_KEY = 'disbit_token_v1', AUTH_USER_KEY = 'disbit_auth_user_v1';
  const atLeast = v => { try { return WA.isVersionAtLeast(v); } catch (e) { return false; } };
  const $ = id => document.getElementById(id);
  const tick = fn => requestAnimationFrame(() => requestAnimationFrame(fn));
  const memory = new Map();
  window.DisbitTokenStore = {
    getItem: k => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => { memory.set(k, String(v)); },
    removeItem: k => { memory.delete(k); }
  };
  document.documentElement.classList.add('tg');
  const state = { token: '', user: null, link: null, startParam: '', bot: '' };
  const guard = fn => { try { return fn(); } catch (e) { /* функция новой версии Bot API недоступна */ } };

  /* ---------- API ---------- */
  async function api(method, path, body, token) {
    const headers = { 'Content-Type': 'application/json', 'X-Time-Zone': zone() };
    if (token || state.token) headers.Authorization = 'Bearer ' + (token || state.token);
    try {
      const response = await fetch('/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      let data = {};
      try { data = await response.json(); } catch (e) { data = {}; }
      return { status: response.status, ok: response.ok, data };
    } catch (e) { return { status: 0, ok: false, data: { error: 'Нет связи с сервером' } }; }
  }
  const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow'; } catch (e) { return 'Europe/Moscow'; } };
  const ext = url => guard(() => WA.openLink(url));

  /* ---------- оформление Telegram ---------- */
  function paintChrome() {
    const bg = (getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#0C1422').trim() || '#0C1422';
    guard(() => { WA.setHeaderColor(bg); WA.setBackgroundColor(bg); WA.setBottomBarColor(bg); });
  }
  function safeArea() {
    const root = document.documentElement.style;
    const s = WA.safeAreaInset || {}, c = WA.contentSafeAreaInset || {};
    root.setProperty('--tg-safe-top', (s.top || 0) + 'px');
    root.setProperty('--tg-safe-bottom', (s.bottom || 0) + 'px');
    root.setProperty('--tg-content-top', (c.top || 0) + 'px');
    root.setProperty('--tg-content-bottom', (c.bottom || 0) + 'px');
  }
  function haptic(kind) {
    guard(() => {
      const h = WA.HapticFeedback;
      if (kind === 'error') h.notificationOccurred('error');
      else if (kind === 'success') h.notificationOccurred('success');
      else h.impactOccurred(kind || 'light');
    });
  }
  WA.expand && guard(() => WA.expand());
  if (atLeast('7.7')) guard(() => WA.disableVerticalSwipes());
  paintChrome(); safeArea();
  ['safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged'].forEach(name => guard(() => WA.onEvent(name, safeArea)));

  /* ---------- экран входа (до загрузки приложения) ---------- */
  const gate = document.createElement('div');
  gate.id = 'tg-gate';
  gate.innerHTML = '<div class="tg-card" role="dialog" aria-modal="true"></div>';
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(gate), { once: true });
  if (document.readyState !== 'loading') document.body.appendChild(gate);
  const card = () => gate.firstChild;
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v; else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v); else node.setAttribute(k, v);
    }
    for (const c of children) if (c) node.append(c);
    return node;
  }
  function show(...nodes) { const c = card(); c.replaceChildren(...nodes); gate.hidden = false; gate.classList.add('on'); }
  const hideGate = () => { gate.hidden = true; gate.classList.remove('on'); };
  const button = (text, onclick, kind = 'btn-primary') => el('button', { class: kind, type: 'button', text, onclick });
  const note = text => el('p', { class: 'tg-note', text });
  function failure(text) { return el('p', { class: 'tg-error', role: 'alert', text }); }

  function reopenScreen() {
    show(el('h1', { class: 'tg-title', text: 'Переоткрой Disbit' }), note('Откройте Disbit заново из чата с ботом.'));
    guard(() => WA.ready());
  }
  function unavailableScreen() {
    show(el('h1', { class: 'tg-title', text: 'Вход через Telegram недоступен' }), note('Попробуйте позже или откройте disbit.ru.'),
      button('Открыть disbit.ru', () => ext(SITE)));
    guard(() => WA.ready());
  }

  function choiceScreen(first) {
    show(
      el('h1', { class: 'tg-title', text: 'Disbit' }),
      note('Сказал — сделал. Обещания с ценой пропуска. Привет' + (first ? ', ' + first : '') + '!'),
      button('Начать', () => consentScreen()),
      button('У меня уже есть аккаунт', () => emailScreen(), 'btn-ghost')
    );
    guard(() => WA.ready());
  }

  function consentScreen() {
    const age = el('input', { type: 'checkbox', id: 'tg-age' });
    const pd = el('input', { type: 'checkbox', id: 'tg-pd' });
    const zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : []);
    const select = el('select', { class: 'field-input', id: 'tg-zone', 'aria-label': 'Часовой пояс' });
    for (const z of (zones.includes(zone()) ? zones : [zone(), ...zones])) select.append(el('option', { value: z, text: z }));
    select.value = zone();
    const error = el('p', { class: 'tg-error', hidden: '', role: 'alert' });
    const link = (text, path) => el('a', { href: SITE + path, text, onclick: e => { e.preventDefault(); ext(SITE + path); } });
    const create = button('Продолжить', async () => {
      if (!age.checked || !pd.checked) { error.textContent = 'Отметьте оба согласия'; error.hidden = false; haptic('error'); return; }
      create.disabled = true;
      const r = await api('POST', '/auth/telegram', { initData: WA.initData, create: true, acceptTerms: true, acceptPersonalData: true, timeZone: select.value }, '');
      create.disabled = false;
      if (r.ok) return enter(r.data);
      error.textContent = r.status === 401 ? 'Переоткройте Disbit из чата с ботом' : (r.data.error || 'Не получилось'); error.hidden = false; haptic('error');
    });
    show(
      el('h1', { class: 'tg-title', text: 'Новый аккаунт' }),
      el('label', { class: 'tg-check' }, age, el('span', {}, document.createTextNode('Мне исполнилось 16 лет. Принимаю '), link('пользовательское соглашение', '/terms.html'), document.createTextNode(' и '), link('правила контента', '/terms.html#content'))),
      el('label', { class: 'tg-check' }, pd, el('span', {}, document.createTextNode('Даю '), link('согласие на обработку персональных данных', '/consent.html'), document.createTextNode(' по '), link('политике', '/privacy'))),
      el('label', { class: 'tg-field' }, el('span', { text: 'Часовой пояс (определён автоматически)' }), select),
      error, create, button('Назад', () => choiceScreen(WA.initDataUnsafe?.user?.first_name), 'btn-ghost')
    );
  }

  function emailScreen() {
    const email = el('input', { class: 'field-input', type: 'email', id: 'tg-email', placeholder: 'Почта аккаунта Disbit', autocomplete: 'email', inputmode: 'email' });
    const error = el('p', { class: 'tg-error', hidden: '', role: 'alert' });
    const send = button('Получить код', async () => {
      send.disabled = true;
      const r = await api('POST', '/auth/telegram/email', { initData: WA.initData, email: email.value.trim() }, '');
      send.disabled = false;
      if (r.ok) return codeScreen(email.value.trim());
      error.textContent = r.status === 401 ? 'Переоткройте Disbit из чата с ботом' : (r.data.error || 'Не получилось'); error.hidden = false; haptic('error');
    });
    show(el('h1', { class: 'tg-title', text: 'Привязать аккаунт' }), note('Мы отправим код на почту, с которой вы входите на disbit.ru.'),
      email, error, send, button('Назад', () => choiceScreen(WA.initDataUnsafe?.user?.first_name), 'btn-ghost'));
  }

  function codeScreen(email, confirmReplace) {
    const code = el('input', { class: 'field-input', id: 'tg-code', type: 'text', inputmode: 'numeric', maxlength: '6', placeholder: 'Код из письма', autocomplete: 'one-time-code' });
    const error = el('p', { class: 'tg-error', hidden: '', role: 'alert' });
    const confirm = button('Подтвердить', async () => {
      confirm.disabled = true;
      const r = await api('POST', '/auth/telegram/email/confirm', { initData: WA.initData, email, code: code.value.trim(), confirmReplace }, '');
      confirm.disabled = false;
      if (r.ok) return enter(r.data);
      if (r.data.needConfirm) return replaceScreen(email, code.value.trim(), r.data.error);
      error.textContent = r.status === 401 ? 'Переоткройте Disbit из чата с ботом' : (r.data.error || 'Не получилось'); error.hidden = false; haptic('error');
    });
    show(el('h1', { class: 'tg-title', text: 'Код из письма' }), code, error, confirm, button('Назад', () => emailScreen(), 'btn-ghost'));
  }
  function replaceScreen(email, codeValue, message) {
    show(el('h1', { class: 'tg-title', text: 'Заменить аккаунт Telegram?' }), note(message),
      button('Продолжить', async () => {
        const r = await api('POST', '/auth/telegram/email/confirm', { initData: WA.initData, email, code: codeValue, confirmReplace: true }, '');
        if (r.ok) return enter(r.data);
        show(el('h1', { class: 'tg-title', text: 'Не получилось' }), failure(r.data.error || 'Попробуйте ещё раз'), button('Назад', () => emailScreen()));
      }),
      button('Отмена', () => choiceScreen(WA.initDataUnsafe?.user?.first_name), 'btn-ghost'));
  }

  /* ---------- вход ---------- */
  async function start() {
    const r = await api('POST', '/auth/telegram', { initData: WA.initData }, '');
    if (r.status === 401) return reopenScreen();
    if (r.status === 503 || r.status === 0) return unavailableScreen();
    if (!r.ok) return unavailableScreen();
    if (r.data.needChoice) { state.startParam = r.data.startParam || ''; return choiceScreen(r.data.firstName); }
    return enter(r.data);
  }

  async function enter(data) {
    state.token = data.token; state.user = data.user; state.link = data.telegram || null;
    state.startParam = data.startParam || state.startParam || '';
    window.DisbitTokenStore.setItem(TOKEN_KEY, data.token);
    try { localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user)); } catch (e) { /* хранилище недоступно */ }
    await resolveStartParam();
    hideGate();
    await loadApp();
  }

  /* Метки startapp (раздел 3): приглашение превращаем в обычные параметры ссылки — их подхватит
     существующий код приглашений; «Отметить» из бота открываем на экране пруфа после загрузки. */
  const pending = { check: null };
  async function resolveStartParam() {
    const p = state.startParam;
    if (!p || !/^(inv|ck)_/.test(p)) return;
    const r = await api('GET', '/telegram/start-param?p=' + encodeURIComponent(p));
    if (!r.ok) return;
    if (r.data.kind === 'invite') history.replaceState(null, '', location.pathname + '?add=' + encodeURIComponent(r.data.login) + '&t=' + encodeURIComponent(r.data.token) + location.hash);
    if (r.data.kind === 'check') pending.check = r.data;
  }

  /* Остальные скрипты страницы ждут входа: сервер пометил их data-tg-src. */
  async function loadApp() {
    const slots = [...document.querySelectorAll('script[data-tg-src]')];
    for (const slot of slots) {
      await new Promise(resolve => {
        const node = document.createElement('script');
        if (slot.dataset.tgType) node.type = slot.dataset.tgType;
        node.src = slot.dataset.tgSrc;
        node.onload = node.onerror = resolve;
        if (slot.dataset.tgType === 'module') resolve();   // модули выполняются отдельно, порядок для них не важен
        slot.after(node);
      });
    }
    // Приложение подписано на DOMContentLoaded, а он уже прошёл: запускаем вручную.
    document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
    wire();
    tick(() => guard(() => WA.ready()));   // ready() — после первой отрисовки (ТЗ 9)
  }

  /* ---------- привязка к приложению ---------- */
  function topSheetId() {
    const proof = $('proof-overlay');
    if (proof && !proof.hidden) return 'proof-overlay';
    const open = window.anyOpenSheet && window.anyOpenSheet();
    return open ? open.id : '';
  }
  const currentScreen = () => (document.querySelector('.screen.active') || {}).id || 'screen-today';

  function syncChrome() {
    const sheet = topSheetId();
    const screen = currentScreen();
    // BackButton: шторка или не-главный экран
    if (sheet || screen !== 'screen-today') guard(() => WA.BackButton.show()); else guard(() => WA.BackButton.hide());
    // MainButton: главное действие экрана
    const main = WA.MainButton;
    let label = '', action = null;
    if (sheet === 'add-overlay') { label = 'Дать обещание'; action = () => $('btn-save') && $('btn-save').click(); }
    else if (sheet === 'proof-overlay') {
      const send = $('proof-send');
      if (send && !send.hidden) { label = 'Отправить пруф'; action = () => send.click(); }
    } else if (!sheet && screen === 'screen-today') { label = 'Создать обещание'; action = () => $('btn-add') && $('btn-add').click(); }
    guard(() => {
      main.offClick(syncChrome.handler);
      syncChrome.handler = action || (() => {});
      if (label) { main.setText(label); main.onClick(syncChrome.handler); main.show(); } else main.hide();
    });
    document.body.classList.toggle('tg-main-button', !!label && !!WA.MainButton.isVisible);
    // Подтверждение закрытия, пока открыта форма обещания (возможны несохранённые данные)
    guard(() => (sheet === 'add-overlay' ? WA.enableClosingConfirmation() : WA.disableClosingConfirmation()));
  }
  syncChrome.handler = () => {};

  function goBack() {
    const sheet = topSheetId();
    if (sheet === 'proof-overlay') { const close = $('proof-close'); if (close) close.click(); return; }
    if (sheet && window.closeSheet) { window.closeSheet(sheet); return; }
    if (window.switchScreen && currentScreen() !== 'screen-today') window.switchScreen('today');
  }

  function interceptLinks() {
    document.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      let url;
      try { url = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
      const external = url.origin !== location.origin;
      const leavesApp = a.target === '_blank' || /\/(terms|privacy|consent|support|safety|delete-account)(\.html)?$/.test(url.pathname);
      if (!external && !leavesApp) return;
      e.preventDefault();
      if (url.hostname === 't.me') guard(() => WA.openTelegramLink(url.href)); else ext(url.origin === location.origin ? SITE + url.pathname.replace(/^\/tg\//, '/') + url.search + url.hash : url.href);
    }, true);
    const open = window.open;
    window.open = function (url) { if (url) ext(new URL(url, location.href).href); return null; };
    window.open.original = open;
  }

  function enableHaptics() {
    document.addEventListener('click', e => {
      if (e.target.closest && e.target.closest('.habit-check')) haptic('medium');
    }, true);
    const toast = window.toast;
    if (typeof toast === 'function') window.toast = function (msg) { if (/не удалось|ошиб|нельзя|сначала|нужно/i.test(String(msg))) haptic('error'); return toast.apply(this, arguments); };
  }

  /* Приглашение: ссылка на бота вместо копирования (раздел 5/8). */
  window.DisbitPlatform = {
    async share(data) {
      let link = data.url;
      try {
        const u = new URL(data.url);
        const token = u.searchParams.get('t');
        if (state.bot && u.searchParams.get('add') && token) link = 'https://t.me/' + state.bot + '/app?startapp=inv_' + token;
      } catch (e) { /* оставляем исходную ссылку */ }
      const text = data.text || 'Присоединяйся к Disbit';
      try {
        WA.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(text));
        return true;
      } catch (e) { return false; }
    },
    renderAccount(box, user) { accountExtras(box, user); }
  };

  /* ---------- профиль: привязки и напоминания ---------- */
  function sheet(title, ...body) {
    const old = $('tg-sheet'); if (old) old.remove();
    const close = () => { overlay.remove(); syncChrome(); };
    const overlay = el('div', { class: 'tg-sheet-overlay', id: 'tg-sheet' },
      el('div', { class: 'tg-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        el('h2', { class: 'tg-title', text: title }), ...body, button('Закрыть', close, 'btn-ghost')));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    return { close, overlay };
  }
  async function refreshLink() { const r = await api('GET', '/telegram/me'); if (r.ok) { state.link = r.data.settings; state.bot = r.data.bot || state.bot; } return r; }

  function remindersSheet() {
    const s = state.link || {};
    const n = s.notify || {};
    const time = (value, label, key) => el('label', { class: 'tg-field' }, el('span', { text: label }), el('input', { class: 'field-input', type: 'time', value, 'data-key': key }));
    const toggle = (checked, label, key) => el('label', { class: 'tg-check' }, el('input', { type: 'checkbox', 'data-notify': key, ...(checked ? { checked: '' } : {}) }), el('span', { text: label }));
    const status = el('p', { class: 'tg-note', role: 'status' });
    const body = el('div', {},
      time(s.remindTime || '09:00', 'Утреннее напоминание', 'remindTime'),
      time(s.quietFrom || '23:00', 'Тихие часы с', 'quietFrom'), time(s.quietTo || '08:00', 'Тихие часы до', 'quietTo'),
      toggle(n.morning !== false, 'Утро', 'morning'), toggle(n.evening !== false, 'Вечернее «не отмечено»', 'evening'),
      toggle(n.lastChance !== false, 'Последний шанс', 'lastChance'), toggle(n.summary !== false, 'Итог дня', 'summary'),
      toggle(n.social !== false, 'Друзья и серии', 'social'), status);
    const { overlay } = sheet('Напоминания в Telegram', body);
    const save = async () => {
      const payload = { notify: {} };
      body.querySelectorAll('input[data-key]').forEach(i => { if (i.value) payload[i.dataset.key] = i.value; });
      body.querySelectorAll('input[data-notify]').forEach(i => { payload.notify[i.dataset.notify] = i.checked; });
      const r = await api('PATCH', '/telegram/settings', payload);
      status.textContent = r.ok ? 'Сохранено' : (r.data.error || 'Не получилось');
      if (r.ok) state.link = r.data.settings;
    };
    body.addEventListener('change', save);
    return overlay;
  }

  function addEmailSheet() {
    const email = el('input', { class: 'field-input', type: 'email', placeholder: 'Почта', autocomplete: 'email' });
    const password = el('input', { class: 'field-input', type: 'password', placeholder: 'Пароль (от 6 символов)', autocomplete: 'new-password' });
    const code = el('input', { class: 'field-input', type: 'text', inputmode: 'numeric', maxlength: '6', placeholder: 'Код из письма', hidden: '' });
    const status = el('p', { class: 'tg-note', role: 'status' });
    const go = button('Получить код', async () => {
      if (code.hidden) {
        const r = await api('POST', '/telegram/add-email', { email: email.value.trim(), password: password.value });
        status.textContent = r.ok ? 'Код отправлен на почту' : (r.data.error || 'Не получилось');
        if (r.ok) { code.hidden = false; go.textContent = 'Подтвердить'; }
        return;
      }
      const r = await api('POST', '/telegram/add-email/confirm', { code: code.value.trim() });
      if (!r.ok) { status.textContent = r.data.error || 'Не получилось'; return; }
      state.user = r.data.user;
      try { localStorage.setItem(AUTH_USER_KEY, JSON.stringify(r.data.user)); } catch (e) { /* не критично */ }
      status.textContent = 'Почта добавлена. Теперь вы можете войти на disbit.ru.';
      if (window.renderAccount) window.renderAccount();
    });
    sheet('Добавить почту и пароль', note('Чтобы не потерять доступ, если Telegram станет недоступен.'), email, password, code, status, go);
  }

  function accountExtras(box, user) {
    if (!box || box.querySelector('[data-tg-extra]')) return;
    const logout = box.querySelector('#btn-logout');
    if (logout) logout.remove();   // выйти из Telegram-аккаунта нельзя: вход идёт по подписи Telegram
    const add = (text, fn) => { const b = el('button', { class: 'row-btn', type: 'button', 'data-tg-extra': '', text, onclick: fn }); box.appendChild(b); };
    add('Напоминания в Telegram', () => { refreshLink().then(remindersSheet); });
    if (user.telegramOnly) add('Добавить почту и пароль', addEmailSheet);
    else add('Отвязать Telegram', async () => {
      const r = await api('DELETE', '/auth/telegram/link');
      toast2(r.ok ? 'Telegram отвязан. Бот больше не будет писать.' : (r.data.error || 'Не получилось'));
    });
  }
  const toast2 = msg => (window.toast ? window.toast(msg) : guard(() => WA.showAlert(msg)));

  /* ---------- разрешение на сообщения бота ---------- */
  async function askWriteAccess() {
    const link = state.link;
    if (!link || link.canWrite || link.blocked) return;
    const asked = link.writeAskedAt;
    if (asked && Date.now() - asked < 7 * 86400000) return;      // отказ — не чаще раза в 7 дней
    if (!atLeast('6.9')) return;
    const banner = el('div', { class: 'tg-banner', role: 'status' },
      el('span', { text: 'Включи напоминания — бот напишет, когда пора отметиться' }),
      button('Включить', () => request(), 'btn-primary'), button('Позже', () => decide(false), 'btn-ghost'));
    function decide(granted) { banner.remove(); api('POST', '/telegram/write-access', { granted }).then(r => { if (r.ok) state.link = r.data.settings; }); }
    function request() { guard(() => WA.requestWriteAccess(ok => decide(!!ok))); }
    if (!asked) request(); else document.body.appendChild(banner);
  }

  function offerHomeScreen() {
    if (!atLeast('8.0') || !state.link) return;
    // ТЗ: ярлык после 3-го дня; признак «уже предлагали» — в хранилище Telegram, если оно есть
    api('GET', '/telegram/me').then(r => {
      if (!r.ok || !r.data.createdAt || Date.now() - r.data.createdAt < 3 * 86400000) return;
      if (localStorage.getItem('disbit_tg_home_v1')) return;
      try { localStorage.setItem('disbit_tg_home_v1', '1'); } catch (e) { /* нет хранилища */ }
      guard(() => WA.addToHomeScreen());
    });
  }

  function openPendingCheck() {
    if (!pending.check || !window.openProofBanner) return;
    const h = (typeof habits !== 'undefined' ? habits : []).find(x => x.id === pending.check.habitId);   // eslint-disable-line no-undef
    pending.check = null;
    if (h) window.openProofBanner(h);
  }

  function wire() {
    paintChrome();
    new MutationObserver(() => tick(syncChrome)).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    new MutationObserver(paintChrome).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('hashchange', () => tick(syncChrome));
    guard(() => WA.BackButton.onClick(goBack));
    interceptLinks(); enableHaptics(); syncChrome();
    refreshLink().then(() => { askWriteAccess(); offerHomeScreen(); });
    setTimeout(openPendingCheck, 1200);
  }

  window.DisbitTelegram = { state, api, haptic };
  // Разметка страницы должна быть разобрана: слоты скриптов приложения ищутся после входа.
  (document.readyState === 'loading' ? new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true })) : Promise.resolve()).then(start);
})();
