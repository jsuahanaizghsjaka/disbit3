// Мини-приложение Telegram (docs/TELEGRAM-TZ.md): вход по initData, кнопки Telegram, заголовки, метки (local fixture only).
async page => {
  const crypto = process.getBuiltinModule('node:crypto');
  const TOKEN = '123456789:TEST-token-for-unit-tests-only';
  const base = 'http://localhost:3337';
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const sign = (user, startParam) => {
    const fields = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAH-test', user: JSON.stringify(user), ...(startParam ? { start_param: startParam } : {}) };
    const check = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
    return new URLSearchParams({ ...fields, hash: crypto.createHmac('sha256', secret).update(check).digest('hex') }).toString();
  };
  // Поддельный SDK: тот же контракт, что у telegram-web-app.js, плюс журнал вызовов в window.__tg.
  const sdk = `(() => {
    const log = window.__tg = { calls: [], main: null, back: null, mainVisible: false, backVisible: false, mainText: '', closing: false, headerColors: [] };
    const rec = (name, ...args) => log.calls.push([name, ...args]);
    window.Telegram = { WebApp: {
      initData: window.__TG_INIT || '', initDataUnsafe: { user: { first_name: 'Тест' } }, version: '9.0',
      safeAreaInset: { top: 0, bottom: 0 }, contentSafeAreaInset: { top: 0, bottom: 0 },
      isVersionAtLeast: () => true, ready: () => rec('ready'), expand: () => rec('expand'),
      setHeaderColor: c => log.headerColors.push(c), setBackgroundColor: () => {}, setBottomBarColor: () => {},
      disableVerticalSwipes: () => {}, enableClosingConfirmation: () => { log.closing = true; }, disableClosingConfirmation: () => { log.closing = false; },
      openLink: u => rec('openLink', u), openTelegramLink: u => rec('openTelegramLink', u),
      requestWriteAccess: cb => { rec('requestWriteAccess'); cb(true); }, addToHomeScreen: () => rec('addToHomeScreen'),
      onEvent: () => {}, HapticFeedback: { impactOccurred: () => {}, notificationOccurred: () => {} },
      MainButton: { setText(t) { log.mainText = t; }, show() { log.mainVisible = true; }, hide() { log.mainVisible = false; }, get isVisible() { return log.mainVisible; },
        onClick(f) { log.main = f; }, offClick() { log.main = null; } },
      BackButton: { show() { log.backVisible = true; }, hide() { log.backVisible = false; }, onClick(f) { log.back = f; } }
    } };
  })();`;
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ contentType: 'application/javascript', body: sdk }));
  await page.route('https://disbit.ru/**', route => route.fulfill({ contentType: 'text/html', body: 'main site' }));
  const open = async (initData, path = '/tg/') => {
    await page.addInitScript(data => { window.__TG_INIT = data; }, initData);
    await page.goto(base + path);
  };
  // «Готово» = приложение загружено и вошло (разметка экрана «Сегодня» есть в HTML с самого начала).
  const appReady = () => page.waitForFunction(() => typeof authUser !== 'undefined' && authUser && window.__tg.calls.some(c => c[0] === 'ready'), null, { timeout: 15000 });
  const result = {};

  // 1) без initData страница уходит на основной сайт
  await open('');
  await page.waitForURL('https://disbit.ru/**');
  result.redirectsWithoutInitData = true;

  // 2) заголовки: /tg/ можно встраивать и грузить SDK, основной сайт — нет
  const headers = (await fetch(base + '/tg/')).headers;
  const main = (await fetch(base + '/')).headers;
  const tgCsp = headers.get('content-security-policy');
  result.tgCsp = tgCsp.includes("script-src 'self' https://telegram.org") && /frame-ancestors [^;]*web\.telegram\.org/.test(tgCsp) && headers.get('x-frame-options') === null;
  result.mainStillDenied = main.get('x-frame-options') === 'DENY' && main.get('content-security-policy').includes("frame-ancestors 'none'");

  // 3) новый человек по метке-приглашению: выбор → согласие → приложение
  const friendToken = await (await fetch(base + '/api/friends', { headers: { Authorization: 'Bearer ' + '1'.repeat(64) } })).json().then(j => j.inviteToken);
  if (!friendToken) throw Error('invite token missing');
  const user = { id: 7001, first_name: 'Тима', username: 'tima_tg', allows_write_to_pm: true };
  await open(sign(user, 'inv_' + friendToken));
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.locator('#tg-age').check();
  await page.locator('#tg-pd').check();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await appReady();
  result.appOpened = true;
  result.tokenNotInLocalStorage = await page.evaluate(() => localStorage.getItem('disbit_token_v1') === null);
  result.userIsTelegramOnly = await page.evaluate(() => authUser && authUser.telegramOnly === true && authUser.email === '');
  await page.waitForFunction(() => window.__tg.calls.some(c => c[0] === 'ready'));
  result.readyCalled = true;

  // 4) кнопки Telegram (приглашение уводит на «Друзья» — возвращаемся на «Сегодня»)
  await page.waitForTimeout(1500);
  await page.evaluate(() => switchScreen('today'));
  await page.waitForFunction(() => window.__tg.mainVisible && window.__tg.mainText === 'Создать обещание');
  result.mainButtonCreate = true;
  result.backHiddenOnToday = await page.evaluate(() => window.__tg.backVisible === false);
  await page.evaluate(() => window.__tg.main());
  await page.getByText('Одно действие, которое повторяется').click();
  await page.waitForFunction(() => !document.getElementById('add-overlay').hidden);
  await page.waitForFunction(() => window.__tg.backVisible && window.__tg.mainText === 'Дать обещание' && window.__tg.closing);
  result.sheetChrome = true;
  await page.evaluate(() => window.__tg.back());
  await page.waitForFunction(() => document.getElementById('add-overlay').hidden && !window.__tg.closing);
  result.backClosesSheet = true;

  // 5) приглашение по метке превратилось в дружбу, привязка видна серверу, внешние ссылки открываются через Telegram
  const me = await page.evaluate(async () => (await fetch('/api/telegram/me', { headers: { Authorization: 'Bearer ' + window.DisbitTokenStore.getItem('disbit_token_v1') } })).json());
  result.linked = me.linked === true && me.telegramOnly === true && me.bot === 'disbit_test_bot';
  await page.waitForTimeout(1500);
  const ownerFriends = await (await fetch(base + '/api/friends', { headers: { Authorization: 'Bearer ' + '1'.repeat(64) } })).json();
  result.friendFromStartParam = (ownerFriends.friends || []).some(f => f.login === 'tima_tg');
  await page.evaluate(() => { const a = document.createElement('a'); a.href = 'privacy.html'; a.id = 'probe'; a.textContent = 'p'; document.body.appendChild(a); });
  await page.click('#probe');
  result.externalViaOpenLink = await page.evaluate(() => window.__tg.calls.some(c => c[0] === 'openLink' && c[1] === 'https://disbit.ru/privacy.html'));

  // 6) повторный запуск: вход без экранов выбора, тот же аккаунт, токена в localStorage по-прежнему нет
  const firstId = await page.evaluate(() => authUser.id);
  await page.goto(base + '/tg/');
  await appReady();
  result.sameAccountOnRelaunch = (await page.evaluate(() => authUser.id)) === firstId;
  result.stillNoStoredToken = await page.evaluate(() => localStorage.getItem('disbit_token_v1') === null);

  // 7) подделка не входит
  const forged = sign(user).replace(/hash=[0-9a-f]+/, 'hash=' + '0'.repeat(64));
  await open(forged);
  await page.waitForSelector('#tg-gate.on');
  result.forgedRejected = (await page.textContent('#tg-gate')).includes('Переоткрой');

  const failed = Object.entries(result).filter(([, v]) => !v).map(([k]) => k);
  if (failed.length || errors.length) throw Error(JSON.stringify({ failed, errors }));
  return result;
}
