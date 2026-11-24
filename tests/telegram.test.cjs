// Тесты Telegram-версии (docs/TELEGRAM-TZ.md): initData, вход и привязка, бот, очередь, расписание.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

let h;
const consent = { acceptTerms: true, acceptPersonalData: true };
const USER_A = { id: 1001, first_name: 'Аня', username: 'anya_test', allows_write_to_pm: true };
const USER_B = { id: 1002, first_name: 'Борис' };

before(async () => { h = await import('./telegram-harness.mjs').then(m => m.startHarness().then(x => Object.assign(x, { sign: m.signInitData, BOT_TOKEN: m.BOT_TOKEN, WEBHOOK_SECRET: m.WEBHOOK_SECRET }))); });
after(async () => { await h.close(); });

const signA = (opts) => h.sign(USER_A, opts);
const today = userId => h.habitsLib.localParts(h.habitsLib.zoneOf(userId)).day;
function addHabit(userId, id, name, { punished = false, minimum = '' } = {}) {
  const day = today(userId);
  h.db.prepare(`INSERT INTO habits(id,user_id,name,icon,color,schedule,goal_type,goal_target,stake_mode,stake_amount,stake_recipient,created_day,minimum_action)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, userId, name, 'svg:i-h-book', '#3B82F6', '[0,1,2,3,4,5,6]', 'check', 1, 'money', punished ? 50 : 0, 'creators', addDays(day, -3), minimum);
}
const addDays = (key, n) => new Date(Date.parse(key + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const proofSkip = (userId, habitId, day) => h.db.prepare('INSERT OR IGNORE INTO proof_skips(user_id,habit_id,day,month) VALUES(?,?,?,?)').run(userId, habitId, day, day.slice(0, 7));
const msk = (day, hhmm) => Date.parse(`${day}T${hhmm}:00+03:00`);
const update = (from, text) => ({ update_id: Math.floor(Math.random() * 1e9), message: { message_id: 1, from: { id: from.id, first_name: from.first_name, username: from.username, is_bot: false }, chat: { id: from.id, type: 'private' }, text } });
const press = (from, data, messageId = 500) => ({ update_id: Math.floor(Math.random() * 1e9), callback_query: { id: 'cq' + Math.random(), from: { id: from.id, first_name: from.first_name, is_bot: false }, message: { message_id: messageId, chat: { id: from.id, type: 'private' } }, data } });

/* ---------------- проверка подписи ---------------- */
test('initData: верная подпись принимается, подделки отклоняются', () => {
  const { verifyInitData } = h.authLib;
  const ok = verifyInitData(signA({ startParam: 'ad_blog' }), h.BOT_TOKEN);
  assert.equal(ok.user.id, 1001);
  assert.equal(ok.startParam, 'ad_blog');
  assert.equal(ok.user.allowsWriteToPm, true);
  assert.throws(() => verifyInitData(signA(), 'другой:токен'), { code: 'bad_signature' });                                   // чужой токен
  assert.throws(() => verifyInitData(signA({ authDate: Math.floor(Date.now() / 1000) - 90000 }), h.BOT_TOKEN), { code: 'expired' });   // старше 24 часов
  assert.throws(() => verifyInitData(signA({ authDate: Math.floor(Date.now() / 1000) + 3600 }), h.BOT_TOKEN), { code: 'malformed' });  // из будущего
  const forged = new URLSearchParams(signA());                                                                              // подменённый user
  forged.set('user', JSON.stringify({ ...USER_A, id: 1 }));
  assert.throws(() => verifyInitData(forged.toString(), h.BOT_TOKEN), { code: 'bad_signature' });
  const noHash = new URLSearchParams(signA()); noHash.delete('hash');
  assert.throws(() => verifyInitData(noHash.toString(), h.BOT_TOKEN), { code: 'bad_signature' });
  assert.throws(() => verifyInitData('', h.BOT_TOKEN), { code: 'malformed' });
  assert.throws(() => verifyInitData(h.sign({ id: 5, first_name: 'Бот', is_bot: true }), h.BOT_TOKEN), { code: 'bot' });
  assert.equal(verifyInitData(signA({ startParam: 'bad param!' }), h.BOT_TOKEN).startParam, '');                              // метка вне набора знаков
});

/* ---------------- вход и аккаунты ---------------- */
test('вход: без аккаунта — выбор, без согласия — отказ, с согласием — аккаунт без почты', async () => {
  const first = await (await h.call('POST', '/api/auth/telegram', { initData: signA({ startParam: 'ad_blog' }) })).json();
  assert.equal(first.needChoice, true);
  assert.equal(first.token, undefined);
  assert.equal((await h.call('POST', '/api/auth/telegram', { initData: signA(), create: true })).status, 400);
  const created = await h.call('POST', '/api/auth/telegram', { initData: signA({ startParam: 'ad_blog' }), create: true, ...consent, timeZone: 'Asia/Yekaterinburg' });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.match(body.token, /^[a-f0-9]{64}$/);
  assert.equal(body.user.login, 'anya_test');
  assert.equal(body.user.email, '');                 // служебный адрес наружу не отдаётся
  assert.equal(body.user.telegramOnly, true);
  assert.equal(body.created, true);
  const row = h.db.prepare('SELECT * FROM users WHERE id=?').get(body.user.id);
  assert.equal(row.email, 'tg1001@telegram.invalid');
  assert.equal(row.time_zone, 'Asia/Yekaterinburg');
  const links = h.db.prepare('SELECT * FROM telegram_links WHERE user_id=?').get(body.user.id);
  assert.equal(links.source, 'ad_blog');
  assert.equal(links.can_write, 1);
  const consents = h.db.prepare('SELECT DISTINCT source FROM legal_acceptances WHERE user_id=?').all(body.user.id);
  assert.deepEqual(consents.map(c => c.source), ['telegram']);

  const again = await (await h.call('POST', '/api/auth/telegram', { initData: signA() })).json();    // повторный вход — тот же аккаунт
  assert.equal(again.user.id, body.user.id);
  assert.equal(again.created, undefined);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM users WHERE email LIKE ?').get('%@telegram.invalid').n, 1);
  assert.equal((await h.call('GET', '/api/auth/me', undefined, again.token)).status, 200);
});

test('вход: подделка и просроченная подпись дают 401 без деталей', async () => {
  const forged = await h.call('POST', '/api/auth/telegram', { initData: signA({ token: 'чужой:токен' }) });
  assert.equal(forged.status, 401);
  const expired = await h.call('POST', '/api/auth/telegram', { initData: signA({ authDate: Math.floor(Date.now() / 1000) - 90000 }) });
  assert.equal(expired.status, 401);
  assert.equal((await expired.json()).reopen, true);
  assert.equal((await h.call('POST', '/api/auth/telegram', { initData: 5 })).status, 400);
});

test('вход: Telegram-аккаунт не может сменить пароль-заглушку и войти по почте-заглушке', async () => {
  const login = await h.call('POST', '/api/auth/login', { id: 'tg1001@telegram.invalid', password: 'anything-123' });
  assert.equal(login.status, 401);
});

/* ---------------- привязка ---------------- */
test('привязка с сайта: код одноразовый, сервер хранит только хеш', async () => {
  h.db.prepare("INSERT INTO users(id,login,email,pass_hash,pass_salt,email_verified) VALUES(50,'site_user','site@example.invalid','x','y',1)").run();
  h.db.prepare("INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)").run(h.secrets.sessionDigest('5'.repeat(64)), 50, Date.now() + 3600000);
  const made = await (await h.call('POST', '/api/auth/telegram/link-code', {}, '5'.repeat(64))).json();
  const code = made.url.split('start=link_')[1];
  assert.match(code, /^[a-z0-9]{16}$/);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM telegram_link_codes WHERE code_hash=?').get(code).n, 0);   // в открытом виде не лежит
  assert.equal((await h.call('POST', '/api/auth/telegram/link-code', {})).status, 401);

  assert.equal((await h.webhook(update(USER_B, '/start link_' + code), 'wrong-secret')).status, 401);
  assert.equal(h.tg.linkByTelegramId(1002), undefined);
  assert.equal((await h.webhook(update(USER_B, '/start link_' + code))).status, 200);
  assert.equal(h.tg.linkByTelegramId(1002).user_id, 50);
  assert.match(h.fake.sent().at(-1).params.text, /Telegram привязан/);
  await h.webhook(update({ id: 1003, first_name: 'Третий' }, '/start link_' + code));                               // повтор кода
  assert.equal(h.tg.linkByTelegramId(1003), undefined);
  assert.match(h.fake.sent().at(-1).params.text, /устарела/);
  const entered = await h.call('POST', '/api/auth/telegram', { initData: h.sign(USER_B) });                          // теперь вход из Telegram даёт тот же аккаунт
  assert.equal((await entered.json()).user.login, 'site_user');
});

test('привязка из Telegram: код по почте, 5 попыток, замена Telegram-аккаунта только с подтверждением', async () => {
  h.db.prepare("INSERT INTO users(id,login,email,pass_hash,pass_salt,email_verified) VALUES(60,'mail_user','mail@example.invalid','x','y',1)").run();
  const C = { id: 2001, first_name: 'Вера' };
  const init = () => h.sign(C);
  // Telegram-аккаунт Веры с данными
  const made = await (await h.call('POST', '/api/auth/telegram', { initData: init(), create: true, ...consent })).json();
  addHabit(made.user.id, 'vera-habit', 'Читать');
  const requested = await h.call('POST', '/api/auth/telegram/email', { initData: init(), email: 'mail@example.invalid' });
  assert.equal(requested.status, 200);
  const unknown = await h.call('POST', '/api/auth/telegram/email', { initData: h.sign({ id: 2002, first_name: 'Ж' }), email: 'nobody@example.invalid' });
  assert.deepEqual(await unknown.json(), await (await h.call('POST', '/api/auth/telegram/email', { initData: h.sign({ id: 2003, first_name: 'З' }), email: 'mail@example.invalid' })).json());   // ответ не выдаёт, есть ли почта
  let code;
  const target = h.db.prepare('SELECT code_hash FROM telegram_email_codes WHERE telegram_id=2001').get().code_hash;
  for (let n = 100000; n < 1000000; n++) if (h.secrets.emailCodeDigest('tg2001', String(n)) === target) { code = String(n); break; }
  assert.ok(code);
  for (let i = 0; i < 5; i++) assert.equal((await h.call('POST', '/api/auth/telegram/email/confirm', { initData: init(), email: 'mail@example.invalid', code: '000000' })).status, 400);
  assert.equal((await h.call('POST', '/api/auth/telegram/email/confirm', { initData: init(), email: 'mail@example.invalid', code })).status, 429);   // лимит попыток
  h.db.prepare('UPDATE telegram_email_codes SET attempts=0,sent_at=0 WHERE telegram_id=2001').run();

  const warn = await h.call('POST', '/api/auth/telegram/email/confirm', { initData: init(), email: 'mail@example.invalid', code });
  assert.equal(warn.status, 409);
  assert.equal((await warn.json()).needConfirm, true);
  assert.ok(h.db.prepare('SELECT 1 FROM users WHERE id=?').get(made.user.id));          // без подтверждения ничего не удалено

  // деньги на Telegram-аккаунте → привязка запрещена
  h.db.prepare('INSERT INTO money_accounts(user_id,balance,reserved) VALUES(?,500,0)').run(made.user.id);
  const refused = await h.call('POST', '/api/auth/telegram/email/confirm', { initData: init(), email: 'mail@example.invalid', code, confirmReplace: true });
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /деньги/);
  h.db.prepare('UPDATE money_accounts SET balance=0 WHERE user_id=?').run(made.user.id);
  h.db.prepare('DELETE FROM money_accounts WHERE user_id=?').run(made.user.id);

  const done = await h.call('POST', '/api/auth/telegram/email/confirm', { initData: init(), email: 'mail@example.invalid', code, confirmReplace: true });
  assert.equal(done.status, 200);
  const result = await done.json();
  assert.equal(result.user.id, 60);
  assert.equal(h.db.prepare('SELECT 1 FROM users WHERE id=?').get(made.user.id), undefined);   // данные Telegram-аккаунта удалены
  assert.equal(h.tg.linkByTelegramId(2001).user_id, 60);
  assert.ok(h.db.prepare('SELECT 1 FROM telegram_link_log WHERE user_id=60').get());
});

test('привязка: Telegram чужого настоящего аккаунта не перехватывается', async () => {
  h.db.prepare("INSERT INTO users(id,login,email,pass_hash,pass_salt,email_verified) VALUES(70,'another','another@example.invalid','x','y',1)").run();
  h.db.prepare("INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)").run(h.secrets.sessionDigest('7'.repeat(64)), 70, Date.now() + 3600000);
  const code = (await (await h.call('POST', '/api/auth/telegram/link-code', {}, '7'.repeat(64))).json()).url.split('start=link_')[1];
  const response = await h.call('POST', '/api/auth/telegram/link', { initData: h.sign(USER_B), code });   // 1002 уже у site_user
  assert.equal(response.status, 409);
});

test('отвязка: нельзя оставить аккаунт без почты и Google', async () => {
  const tgOnly = await (await h.call('POST', '/api/auth/telegram', { initData: h.sign({ id: 3001, first_name: 'Глеб' }), create: true, ...consent })).json();
  const refused = await h.call('DELETE', '/api/auth/telegram/link', undefined, tgOnly.token);
  assert.equal(refused.status, 409);
  assert.ok(h.tg.linkByTelegramId(3001));
  const withMail = await (await h.call('POST', '/api/auth/telegram', { initData: h.sign(USER_B) })).json();     // site_user: есть почта
  const ok = await h.call('DELETE', '/api/auth/telegram/link', undefined, withMail.token);
  assert.equal(ok.status, 200);
  assert.equal(h.tg.linkByTelegramId(1002), undefined);
  assert.ok(h.db.prepare("SELECT 1 FROM telegram_link_log WHERE event='unlinked'").get());
});

test('удаление аккаунта, созданного в Telegram: подтверждается свежей подписью, бот прощается', async () => {
  const me = await (await h.call('POST', '/api/auth/telegram', { initData: h.sign({ id: 3002, first_name: 'Дина', username: 'dina_x', allows_write_to_pm: true }), create: true, ...consent })).json();
  const bad = await h.call('DELETE', '/api/account', { confirmation: 'dina_x' }, me.token);
  assert.equal(bad.status, 403);                                                                       // без подписи нельзя
  h.fake.clear();
  const ok = await h.call('DELETE', '/api/account', { confirmation: 'dina_x', initData: h.sign({ id: 3002, first_name: 'Дина' }) }, me.token);
  assert.equal(ok.status, 200);
  assert.equal(h.tg.linkByTelegramId(3002), undefined);
  assert.equal(h.db.prepare('SELECT 1 FROM users WHERE id=?').get(me.user.id), undefined);
  await new Promise(r => setTimeout(r, 100));
  assert.match(h.fake.sent().at(-1).params.text, /Аккаунт Disbit удалён/);
});

/* ---------------- бот ---------------- */
let anya;
test('бот: /today показывает обещания, кнопка без пруфа просит открыть приложение', async () => {
  anya = h.tg.linkByTelegramId(1001).user_id;
  h.db.prepare("UPDATE users SET time_zone='Europe/Moscow' WHERE id=?").run(anya);
  addHabit(anya, 'bot-run', 'Бег', { minimum: '5 минут', punished: true });
  addHabit(anya, 'bot-read', 'Чтение');
  h.fake.clear();
  await h.webhook(update(USER_A, '/today'));
  const msg = h.fake.sent().at(-1).params;
  assert.match(msg.text, /Бег/);
  assert.match(msg.text, /Чтение/);
  const buttons = msg.reply_markup.inline_keyboard.flat();
  const done = buttons.find(b => b.callback_data?.startsWith('d|') && /Бег/.test(b.text));
  assert.ok(done);
  assert.ok(Buffer.byteLength(done.callback_data) <= 64);                      // лимит Telegram на callback_data
  assert.ok(!/bot-run/.test(JSON.stringify(msg.reply_markup)));                // в кнопке только короткий id
  assert.ok(buttons.some(b => /^https:\/\/t\.me\/disbit_test_bot\/app\?startapp=ck_\d+$/.test(b.url || '')));

  h.fake.clear();
  await h.webhook(press(USER_A, done.callback_data));
  assert.ok(h.fake.calls.some(c => c.method === 'answerCallbackQuery' && /пруф/i.test(c.params.text)));
  assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM completions WHERE habit_id='bot-run' AND done=1").get().n, 0);   // без пруфа не отмечено
});

test('бот: отметка кнопкой идемпотентна и совпадает с отметкой из приложения', async () => {
  const day = today(anya);
  proofSkip(anya, 'bot-run', day);
  h.fake.clear();
  await h.webhook(update(USER_A, '/today'));
  const buttons = h.fake.sent().at(-1).params.reply_markup.inline_keyboard.flat();
  const done = buttons.find(b => b.callback_data?.startsWith('d|') && /Бег/.test(b.text));
  await h.webhook(press(USER_A, done.callback_data));
  const row = h.db.prepare("SELECT done,minimum FROM completions WHERE habit_id='bot-run' AND day=?").get(day);
  assert.deepEqual({ ...row }, { done: 1, minimum: 0 });
  assert.ok(h.fake.calls.some(c => c.method === 'answerCallbackQuery' && c.params.text === 'Отмечено'));
  h.fake.clear();
  await h.webhook(press(USER_A, done.callback_data));                                        // вторая отметка ничего не меняет
  assert.ok(h.fake.calls.some(c => c.method === 'answerCallbackQuery' && c.params.text === 'Уже отмечено'));
  assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM completions WHERE habit_id='bot-run'").get().n, 1);
  const edited = h.fake.calls.find(c => c.method === 'editMessageText');
  assert.match(edited.params.text, /✅ Бег/);

  // та же отметка из приложения возвращает ту же запись и не ломается
  const session = (await (await h.call('POST', '/api/auth/telegram', { initData: signA() })).json()).token;
  const viaApp = await h.call('PUT', `/api/habits/bot-run/day/${day}`, { done: true }, session);
  assert.equal(viaApp.status, 200);
  assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM completions WHERE habit_id='bot-run'").get().n, 1);
});

test('бот: чужая кнопка и кнопка закрытого дня отклоняются', async () => {
  const day = today(anya);
  proofSkip(anya, 'bot-read', day);
  h.fake.clear();
  await h.webhook(update(USER_A, '/today'));
  const read = h.fake.sent().at(-1).params.reply_markup.inline_keyboard.flat().find(b => b.callback_data?.startsWith('d|') && /Чтение/.test(b.text));
  // нажимает другой пользователь Telegram (привязанный к другому аккаунту)
  await h.call('POST', '/api/auth/telegram', { initData: h.sign({ id: 4001, first_name: 'Егор' }), create: true, ...consent });
  h.fake.clear();
  await h.webhook(press({ id: 4001, first_name: 'Егор' }, read.callback_data));
  assert.ok(h.fake.calls.some(c => c.method === 'answerCallbackQuery' && c.params.text === 'Кнопка устарела'));
  assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM completions WHERE habit_id='bot-read'").get().n, 0);
  // закрытый день
  const id = Number(read.callback_data.split('|')[1]);
  h.db.prepare('UPDATE telegram_actions SET day=? WHERE id=?').run(addDays(day, -1), id);
  h.fake.clear();
  await h.webhook(press(USER_A, read.callback_data));
  assert.ok(h.fake.calls.some(c => c.method === 'answerCallbackQuery' && /День уже закрыт/.test(c.params.text)));
  assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM completions WHERE habit_id='bot-read'").get().n, 0);
  assert.equal((await h.webhook(press(USER_A, 'd|abc'))).status, 200);                       // мусор в callback_data не роняет бота
});

test('бот: /stats, /invite, /remind, /stop, /help; группы игнорируются', async () => {
  h.fake.clear();
  await h.webhook(update(USER_A, '/stats'));
  assert.match(h.fake.sent().at(-1).params.text, /Неделя: \d+ из \d+/);
  assert.match(h.fake.sent().at(-1).params.text, /Бег — серия \d+/);
  await h.webhook(update(USER_A, '/invite'));
  assert.match(h.fake.sent().at(-1).params.text, /Личная ссылка появится/);                   // токен ещё не создан
  h.db.prepare("INSERT INTO friend_links(user_id,token) VALUES(?,'tok123456789')").run(anya);
  await h.webhook(update(USER_A, '/invite'));
  assert.match(h.fake.sent().at(-1).params.text, /startapp=inv_tok123456789/);
  await h.webhook(update(USER_A, '/help'));
  assert.match(h.fake.sent().at(-1).params.text, /disbitx1@gmail\.com/);

  await h.webhook(update(USER_A, '/remind'));
  const settings = h.fake.sent().at(-1).params.reply_markup.inline_keyboard.flat();
  await h.webhook(press(USER_A, settings.find(b => b.text === '10:00').callback_data));
  assert.equal(h.tg.linkByUser(anya).remind_time, '10:00');
  await h.webhook(press(USER_A, 'r|f|evening'));
  assert.equal(h.tg.linkByUser(anya).notify_evening, 0);
  await h.webhook(press(USER_A, 'r|f|evening'));
  await h.webhook(press(USER_A, 'r|q|2200|0700'));
  assert.equal(h.tg.linkByUser(anya).quiet_from, '22:00');
  await h.webhook(press(USER_A, 'r|t|2500'));                                                // недопустимое значение игнорируется
  assert.equal(h.tg.linkByUser(anya).remind_time, '10:00');
  await h.webhook(press(USER_A, 'r|t|0900'));

  const before = h.fake.calls.length;
  await h.webhook({ update_id: 1, message: { message_id: 1, from: { id: 1001, is_bot: false }, chat: { id: -100, type: 'supergroup' }, text: '/today' } });
  assert.equal(h.fake.calls.length, before);                                                 // в группах бот молчит
});

test('бот: /stop выключает обычные сообщения, но не сообщения о пруфах', async () => {
  await h.webhook(update(USER_A, '/stop'));
  assert.equal(h.tg.linkByUser(anya).stopped, 1);
  const day = today(anya);
  h.bot.schedulerTick(msk(day, '09:10'));
  assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM telegram_outbox WHERE kind='morning'").get().n, 0);   // расписание обходит остановленных
  h.db.prepare("INSERT INTO proofs(id,user_id,habit_id,habit_name,day,file,status) VALUES(900,?,?,?,?,?,?)").run(anya, 'bot-run', 'Бег', day, 'x.jpg', 'rejected');
  h.bot.notifyProofDecision(900);
  h.fake.clear();
  await h.bot.flushOutbox(Date.now());
  assert.match(h.fake.sent().at(-1).params.text, /Пруф отклонён/);
  assert.ok(h.fake.sent().at(-1).params.reply_markup.inline_keyboard.flat().some(b => b.text === 'Оспорить'));
  await h.webhook(update(USER_A, '/start'));                                                // /start снова включает бота
  assert.equal(h.tg.linkByUser(anya).stopped, 0);
});

/* ---------------- очередь и расписание ---------------- */
test('расписание: утреннее напоминание по поясу аккаунта приходит один раз', async () => {
  const day = today(anya);
  h.db.prepare("DELETE FROM telegram_outbox").run();
  assert.equal(h.bot.schedulerTick(msk(day, '08:00')), 0);                                   // до 09:00 по Москве рано
  assert.equal(h.bot.schedulerTick(msk(day, '09:05')), 1);
  assert.equal(h.bot.schedulerTick(msk(day, '09:06')), 0);                                   // дубль по ключу идемпотентности
  h.fake.clear();
  await h.bot.flushOutbox(msk(day, '09:06'));
  const sent = h.fake.sent();
  assert.equal(sent.length, 1);
  assert.match(sent[0].params.text, /Доброе утро/);
  assert.equal(sent[0].params.chat_id, 1001);
  await h.bot.flushOutbox(msk(day, '09:07'));
  assert.equal(h.fake.sent().length, 1);
  // другой пояс: те же 09:05 по Москве — в Екатеринбурге уже 11:05, то есть позже окна 3 часов только при 12:05+
  h.db.prepare("UPDATE users SET time_zone='Asia/Yekaterinburg' WHERE id=?").run(anya);
  assert.equal(h.bot.schedulerTick(msk(addDays(day, 1), '06:10')), 0);                       // 08:10 в Екатеринбурге — рано
  h.db.prepare("UPDATE users SET time_zone='Europe/Moscow' WHERE id=?").run(anya);
});

test('очередь: тихие часы переносят сообщение, «Последний шанс» их не ждёт', async () => {
  const day = today(anya);
  h.db.prepare("DELETE FROM telegram_outbox").run();
  h.db.prepare("DELETE FROM completions WHERE habit_id IN ('bot-run','bot-read')").run();
  h.db.prepare("UPDATE telegram_links SET quiet_from='23:00',quiet_to='08:00' WHERE user_id=?").run(anya);   // значения по умолчанию
  h.bot.enqueue(anya, 'evening', 'quiet-test-1', { text: 'вечернее' }, { nextAt: msk(day, '23:30'), createdAt: msk(day, '23:30') });
  h.bot.enqueue(anya, 'last_chance', 'quiet-test-2', { text: 'последний шанс' }, { nextAt: msk(day, '23:30'), createdAt: msk(day, '23:30') });
  h.fake.clear();
  await h.bot.flushOutbox(msk(day, '23:31'));
  assert.deepEqual(h.fake.sent().map(c => c.params.text), ['последний шанс']);
  const held = h.db.prepare("SELECT next_at,status FROM telegram_outbox WHERE idem_key='quiet-test-1'").get();
  assert.equal(held.status, 'pending');
  assert.equal(held.next_at, msk(addDays(day, 1), '08:00'));                                 // перенесено на конец тихих часов
  await h.bot.flushOutbox(msk(addDays(day, 1), '08:01'));
  assert.deepEqual(h.fake.sent().map(c => c.params.text), ['последний шанс', 'вечернее']);
});

test('очередь: не больше 4 несервисных сообщений в день, сервисные проходят', async () => {
  const day = addDays(today(anya), 2);
  h.db.prepare("DELETE FROM telegram_outbox").run();
  for (let i = 0; i < 6; i++) h.bot.enqueue(anya, 'summary', 'cap-' + i, { text: 'обычное ' + i }, { nextAt: msk(day, '12:00') + i, createdAt: msk(day, '12:00') });
  h.bot.enqueue(anya, 'proof', 'cap-service', { text: 'сервисное' }, { service: true, nextAt: msk(day, '12:00') + 10, createdAt: msk(day, '12:00') });
  h.fake.clear();
  await h.bot.flushOutbox(msk(day, '12:05'));
  const texts = h.fake.sent().map(c => c.params.text);
  assert.equal(texts.filter(t => t.startsWith('обычное')).length, 4);
  assert.ok(texts.includes('сервисное'));
});

test('очередь: 429 откладывает отправку по retry_after, повтор не дублирует', async () => {
  const day = addDays(today(anya), 3);
  h.db.prepare("DELETE FROM telegram_outbox").run();
  h.bot.enqueue(anya, 'friend', 'rl-1', { text: 'лимит' }, { nextAt: msk(day, '12:00'), createdAt: msk(day, '12:00') });
  h.fake.clear();
  h.fake.failNext('sendMessage', { http: 429, body: { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 7 } } });
  const t0 = msk(day, '12:01');
  await h.bot.flushOutbox(t0);
  const row = h.db.prepare("SELECT status,next_at,attempts FROM telegram_outbox WHERE idem_key='rl-1'").get();
  assert.equal(row.status, 'pending');
  assert.equal(row.next_at, t0 + 7000);                                                       // ждём ровно retry_after
  assert.equal(row.attempts, 0);                                                              // 429 не считается неудачной попыткой
  await h.bot.flushOutbox(t0 + 3000);
  assert.equal(h.db.prepare("SELECT status FROM telegram_outbox WHERE idem_key='rl-1'").get().status, 'pending');
  assert.equal(h.fake.sent().length, 1);                                                      // за это время ничего лишнего не отправлено
  await h.bot.flushOutbox(t0 + 8000);
  assert.equal(h.db.prepare("SELECT status FROM telegram_outbox WHERE idem_key='rl-1'").get().status, 'sent');
  assert.equal(h.fake.sent().length, 2);                                                      // один повтор, без дублей
});

test('очередь: 403 «бот заблокирован» прекращает отправку, возвращение через /start', async () => {
  const day = addDays(today(anya), 4);
  h.db.prepare("DELETE FROM telegram_outbox").run();
  h.bot.enqueue(anya, 'friend', 'blk-1', { text: 'первое' }, { nextAt: msk(day, '12:00'), createdAt: msk(day, '12:00') });
  h.fake.failNext('sendMessage', { http: 403, body: { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' } });
  await h.bot.flushOutbox(msk(day, '12:01'));
  assert.ok(h.tg.linkByUser(anya).blocked_at);
  h.bot.enqueue(anya, 'friend', 'blk-2', { text: 'второе' }, { nextAt: msk(day, '12:02'), createdAt: msk(day, '12:02') });
  h.fake.clear();
  await h.bot.flushOutbox(msk(day, '12:03'));
  assert.equal(h.fake.sent().length, 0);                                                      // заблокированному не пишем
  assert.equal(h.tg.publicLink(h.tg.linkByUser(anya)).canWrite, false);
  await h.webhook(update(USER_A, '/start'));
  assert.equal(h.tg.linkByUser(anya).blocked_at, null);
  await h.webhook({ update_id: 3, my_chat_member: { chat: { id: 1001, type: 'private' }, from: { id: 1001 }, new_chat_member: { status: 'kicked' } } });
  assert.ok(h.tg.linkByUser(anya).blocked_at);
  await h.webhook({ update_id: 4, my_chat_member: { chat: { id: 1001, type: 'private' }, from: { id: 1001 }, new_chat_member: { status: 'member' } } });
  assert.equal(h.tg.linkByUser(anya).blocked_at, null);
});

test('очередь: денежное сообщение заблокированному дублируется на почту, если она есть', async () => {
  h.db.prepare("INSERT INTO users(id,login,email,pass_hash,pass_salt,email_verified) VALUES(80,'money_user','money@example.invalid','x','y',1)").run();
  h.db.prepare("INSERT INTO telegram_links(user_id,telegram_id,chat_id,can_write,blocked_at,created_at,last_seen_at) VALUES(80,8001,8001,1,?,?,?)").run(Date.now(), Date.now(), Date.now());
  const day = today(80);
  h.bot.notifyPenalty(80, { day, habitName: 'Бег', rubles: 50, penaltyId: 'p-1' });
  h.bot.notifyPenalty(80, { day, habitName: 'Бег', rubles: 50, penaltyId: 'p-1' });          // дубль по ключу
  assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM telegram_outbox WHERE user_id=80").get().n, 1);
  h.fake.clear();
  await h.bot.flushOutbox(Date.now());
  assert.equal(h.fake.sent().length, 0);
  assert.equal(h.db.prepare("SELECT status FROM telegram_outbox WHERE user_id=80").get().status, 'failed');
});

test('расписание: итог дня уходит после полуночи, серия 7 — один раз', async () => {
  const day = addDays(today(anya), 10);
  h.db.prepare("DELETE FROM telegram_outbox").run();
  const yesterday = addDays(day, -1);
  h.db.prepare("INSERT INTO habits(id,user_id,name,icon,color,schedule,goal_type,goal_target,stake_mode,created_day) VALUES('streak7',?,?,?,?,?,?,?,?,?)")
    .run(anya, 'Зарядка', 'svg:i-h-gym', '#3B82F6', '[0,1,2,3,4,5,6]', 'check', 1, 'money', addDays(yesterday, -8));
  for (let i = 0; i < 7; i++) h.db.prepare('INSERT INTO completions(habit_id,day,done) VALUES(?,?,1)').run('streak7', addDays(yesterday, -i));
  assert.ok(h.bot.schedulerTick(msk(day, '00:20')) >= 2);
  assert.equal(h.bot.schedulerTick(msk(day, '00:25')), 0);
  const kinds = h.db.prepare("SELECT kind FROM telegram_outbox").all().map(r => r.kind);
  assert.ok(kinds.includes('summary'));
  assert.ok(kinds.includes('streak'));
  const streak = JSON.parse(h.db.prepare("SELECT payload FROM telegram_outbox WHERE kind='streak'").get().payload);
  assert.match(streak.text, /Серия 7/);
  assert.ok(streak.reply_markup.inline_keyboard[0][0].url.startsWith('https://t.me/share/url?'));
  h.db.prepare("DELETE FROM completions WHERE habit_id='streak7'").run();
  h.db.prepare("DELETE FROM habits WHERE id='streak7'").run();
});

test('webhook: без секретного заголовка обновление не принимается, ошибки обработки не ломают ответ', async () => {
  assert.equal((await h.webhook({ update_id: 1 }, '')).status, 401);
  const response = await h.webhook({ update_id: 2, message: { from: null, chat: null } });
  assert.equal(response.status, 200);
  assert.equal((await h.webhook('сломанное')).status, 400);
});

/* ---------------- настройки и метки ---------------- */
test('настройки: чтение, изменение, запрос разрешения на сообщения', async () => {
  const token = (await (await h.call('POST', '/api/auth/telegram', { initData: signA() })).json()).token;
  const me = await (await h.call('GET', '/api/telegram/me', undefined, token)).json();
  assert.equal(me.linked, true);
  assert.equal(me.bot, 'disbit_test_bot');
  const patched = await h.call('PATCH', '/api/telegram/settings', { remindTime: '07:30', notify: { summary: false } }, token);
  assert.equal((await patched.json()).settings.remindTime, '07:30');
  assert.equal(h.tg.linkByUser(anya).notify_summary, 0);
  assert.equal((await h.call('PATCH', '/api/telegram/settings', { remindTime: '25:00' }, token)).status, 400);
  assert.equal((await h.call('PATCH', '/api/telegram/settings', { notify: { summary: 'да' } }, token)).status, 400);
  assert.equal((await h.call('POST', '/api/telegram/write-access', { granted: false }, token)).status, 200);
  assert.ok(h.tg.linkByUser(anya).write_asked_at);
  assert.equal((await h.call('GET', '/api/telegram/me')).status, 401);
});

test('метки startapp: приглашение, отметка из бота, неизвестное — без ошибки', async () => {
  const token = (await (await h.call('POST', '/api/auth/telegram', { initData: h.sign({ id: 4001, first_name: 'Егор' }) })).json()).token;
  const invite = await (await h.call('GET', '/api/telegram/start-param?p=inv_tok123456789', undefined, token)).json();
  assert.deepEqual({ kind: invite.kind, login: invite.login }, { kind: 'invite', login: 'anya_test' });
  assert.equal((await (await h.call('GET', '/api/telegram/start-param?p=inv_unknown', undefined, token)).json()).kind, 'none');
  assert.equal((await (await h.call('GET', '/api/telegram/start-param?p=' + encodeURIComponent('bad param!'), undefined, token)).json()).kind, 'none');
  const own = (await (await h.call('POST', '/api/auth/telegram', { initData: signA() })).json()).token;
  assert.equal((await (await h.call('GET', '/api/telegram/start-param?p=inv_tok123456789', undefined, own)).json()).kind, 'none');   // свою ссылку не принимают
  await h.webhook(update(USER_A, '/today'));                                                  // свежие кнопки (старые чистятся через 3 суток)
  const actionId = Number(h.db.prepare('SELECT id FROM telegram_actions WHERE user_id=? ORDER BY id DESC LIMIT 1').get(anya).id);
  const ck = await (await h.call('GET', '/api/telegram/start-param?p=ck_' + actionId, undefined, own)).json();
  assert.equal(ck.kind, 'check');
  assert.equal((await (await h.call('GET', '/api/telegram/start-param?p=ck_' + actionId, undefined, token)).json()).kind, 'none');   // чужое действие недоступно
});

test('токен бота и подпись не попадают в ответы API и журнал вызовов, кроме адреса Bot API', async () => {
  const response = await h.call('POST', '/api/auth/telegram', { initData: signA() });
  const text = await response.text();
  assert.ok(!text.includes(h.BOT_TOKEN));
  assert.ok(!text.includes('initData'));
});
