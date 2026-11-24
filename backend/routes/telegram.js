/* Маршруты Telegram: вход Mini App, привязка аккаунта, webhook бота, настройки.
   ТЗ docs/TELEGRAM-TZ.md, разделы 4, 6 и 9. */
import { Router } from 'express';
import { createHash, randomInt, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from '../db/db.js';
import { createSession, publicUser } from './auth.js';
import { hasConsent, CONSENT_ERROR } from '../lib/legal.js';
import { isEmailFormatValid, domainAcceptsMail, sendMail, verifyCodeHtml } from '../lib/email.js';
import { emailCodeDigest } from '../lib/auth-secrets.js';
import { requestLimit } from '../lib/request-limits.js';
import { verifyInitData, InitDataError, sanitizeStartParam } from '../lib/telegram-auth.js';
import {
  telegramConfig, telegramEnabled, linkByTelegramId, linkByUser, createTelegramAccount, touchLink, linkTelegram,
  unlinkTelegram, issueLinkCode, publicLink, isTelegramOnly
} from '../lib/telegram.js';
import { handleUpdate } from '../lib/telegram-bot.js';
import { eraseAccountFully } from './account.js';
import { consumeLinkCode } from '../lib/telegram.js';

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const sha = value => createHash('sha256').update(String(value)).digest();

/* Одинаковый ответ для любой причины отказа: клиент показывает «Переоткрой Disbit» (ТЗ 10). */
function identify(req, res) {
  if (!telegramEnabled()) { res.status(503).json({ error: 'Вход через Telegram пока недоступен' }); return null; }
  try { return verifyInitData(req.body?.initData, telegramConfig().token); }
  catch (error) {
    const expired = error instanceof InitDataError && error.code === 'expired';
    res.status(401).json({ error: 'Переоткройте Disbit из чата с ботом', ...(expired ? { reopen: true } : {}) });
    return null;
  }
}
const validZone = zone => { try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); return typeof zone === 'string' && zone.length < 64; } catch { return false; } };
const limitIp = requestLimit('telegram-auth-ip', 90, 15 * 60000);

/* ---------- /api/auth/telegram ---------- */
export const telegramAuthRouter = Router();
telegramAuthRouter.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
for (const field of ['initData']) telegramAuthRouter.use((req, res, next) => {
  const value = req.body?.[field];
  if (value !== undefined && (typeof value !== 'string' || value.length > 4096)) return res.status(400).json({ error: 'Некорректные поля запроса' });
  next();
});

/* Вход или создание аккаунта. Без привязки и без согласия возвращает needConsent / needChoice. */
telegramAuthRouter.post('/', limitIp, asyncRoute(async (req, res) => {
  const init = identify(req, res); if (!init) return;
  const link = touchLink(init.user);
  if (link) {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(link.user_id);
    if (!user) return res.status(401).json({ error: 'Переоткройте Disbit из чата с ботом' });
    return res.json({ token: createSession(user.id), user: publicUser(user), telegram: publicLink(linkByUser(user.id)), startParam: init.startParam });
  }
  // Аккаунта нет. Выбор «уже есть аккаунт» делает клиент через /email; «начать заново» — это create:true.
  if (req.body?.create !== true) return res.json({ needChoice: true, startParam: init.startParam, firstName: init.user.firstName });
  if (!hasConsent(req.body)) return res.status(400).json({ error: CONSENT_ERROR, needConsent: true });
  const user = createTelegramAccount(init.user, { source: init.startParam, hashPassword });
  if (validZone(req.body?.timeZone)) db.prepare('UPDATE users SET time_zone=? WHERE id=? AND time_zone IS NULL').run(req.body.timeZone, user.id);
  res.status(201).json({ token: createSession(user.id), user: publicUser(user), telegram: publicLink(linkByUser(user.id)), created: true, startParam: init.startParam });
}));

/* Привязка со стороны Telegram: письмо с кодом на почту существующего аккаунта. */
const EMAIL_TTL = 15 * 60000, EMAIL_COOLDOWN = 60000, EMAIL_ATTEMPTS = 5;
telegramAuthRouter.post('/email', limitIp, asyncRoute(async (req, res) => {
  const init = identify(req, res); if (!init) return;
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!isEmailFormatValid(email)) return res.status(400).json({ error: 'Некорректная почта' });
  const reply = { ok: true, message: 'Если такой аккаунт есть, код отправлен на почту.' };
  const prev = db.prepare('SELECT sent_at FROM telegram_email_codes WHERE telegram_id=?').get(init.user.id);
  if (prev && Date.now() - prev.sent_at < EMAIL_COOLDOWN) return res.status(429).json({ error: 'Подождите минуту перед повторной отправкой.' });
  const user = db.prepare('SELECT id,email FROM users WHERE email=?').get(email);
  const code = String(randomInt(100000, 1000000));
  // Запись создаём всегда: по ответу нельзя понять, есть ли такая почта.
  db.prepare(`INSERT INTO telegram_email_codes(telegram_id,email,code_hash,expires_at,sent_at,attempts) VALUES(?,?,?,?,?,0)
    ON CONFLICT(telegram_id) DO UPDATE SET email=excluded.email,code_hash=excluded.code_hash,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0`)
    .run(init.user.id, email, emailCodeDigest('tg' + init.user.id, code), Date.now() + EMAIL_TTL, Date.now());
  if (user && !/@telegram\.invalid$/.test(user.email)) {
    try { await sendMail(email, 'Disbit — код привязки Telegram', verifyCodeHtml(code)); }
    catch { console.error('[telegram] link mail delivery failed'); }
  }
  res.json(reply);
}));

function finishLink(res, userId, init, options) {
  const result = linkTelegram(userId, init.user, { source: options.source, confirmReplace: options.confirmReplace, eraseAccountFully });
  if (result.error) return res.status(result.status || 409).json({ error: result.error, ...(result.needConfirm ? { needConfirm: true } : {}) });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  return res.json({ ok: true, token: createSession(userId), user: publicUser(user), telegram: publicLink(linkByUser(userId)) });
}

telegramAuthRouter.post('/email/confirm', limitIp, asyncRoute(async (req, res) => {
  const init = identify(req, res); if (!init) return;
  const row = db.prepare('SELECT * FROM telegram_email_codes WHERE telegram_id=?').get(init.user.id);
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!row || row.email !== email || Date.now() > row.expires_at) return res.status(400).json({ error: 'Код недействителен или истёк' });
  if (row.attempts >= EMAIL_ATTEMPTS) return res.status(429).json({ error: 'Слишком много попыток — запросите новый код' });
  const guess = emailCodeDigest('tg' + init.user.id, String(req.body?.code || '').trim());
  if (guess !== row.code_hash) {
    db.prepare('UPDATE telegram_email_codes SET attempts=attempts+1 WHERE telegram_id=?').run(init.user.id);
    return res.status(400).json({ error: 'Неверный код' });
  }
  const user = db.prepare('SELECT id,email FROM users WHERE email=?').get(email);
  if (!user || /@telegram\.invalid$/.test(user.email)) return res.status(400).json({ error: 'Код недействителен или истёк' });
  const response = finishLink(res, user.id, init, { source: 'email', confirmReplace: req.body?.confirmReplace });
  if (res.statusCode < 400) db.prepare('DELETE FROM telegram_email_codes WHERE telegram_id=?').run(init.user.id);
  return response;
}));

/* Привязка со стороны сайта: код из профиля disbit.ru (одноразовый, 10 минут). */
telegramAuthRouter.post('/link-code', asyncRoute(async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Нужен аккаунт' });
  if (!telegramEnabled()) return res.status(503).json({ error: 'Вход через Telegram пока недоступен' });
  const username = telegramConfig().username;
  if (!username) return res.status(503).json({ error: 'Бот Telegram не настроен' });
  const code = issueLinkCode(req.userId);
  res.json({ url: `https://t.me/${username}?start=link_${code}`, expiresInSeconds: 600 });
}));
// Тот же код можно ввести в мини-приложении (если ссылку открыли не из бота).
telegramAuthRouter.post('/link', limitIp, asyncRoute(async (req, res) => {
  const init = identify(req, res); if (!init) return;
  const userId = consumeLinkCode(String(req.body?.code || ''));
  if (!userId) return res.status(400).json({ error: 'Код недействителен или истёк' });
  return finishLink(res, userId, init, { source: 'web', confirmReplace: req.body?.confirmReplace });
}));
telegramAuthRouter.delete('/link', asyncRoute(async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Нужен аккаунт' });
  const result = unlinkTelegram(req.userId);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true });
}));

/* ---------- /api/telegram ---------- */
export const telegramRouter = Router();
const secureEqual = (a, b) => timingSafeEqual(sha(a), sha(b));

telegramRouter.post('/webhook', asyncRoute(async (req, res) => {
  const { secret } = telegramConfig();
  const header = req.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (!secret || !secureEqual(header, secret)) return res.status(401).json({ ok: false });
  try { await handleUpdate(req.body || {}, { eraseAccountFully }); }
  catch { console.error('[telegram] update handling failed'); }       // 200 всё равно: Telegram не должен повторять
  res.json({ ok: true });
}));

telegramRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!req.userId) return res.status(401).json({ error: 'Нужен аккаунт' });
  next();
});
telegramRouter.get('/me', (req, res) => {
  const link = linkByUser(req.userId);
  res.json({ linked: !!link, telegramOnly: isTelegramOnly(req.userId), settings: publicLink(link),
    bot: telegramConfig().username || null, createdAt: link?.created_at || null });
});

/* Добавить почту и пароль к аккаунту, созданному в Telegram (ТЗ 4): после кода из письма аккаунт доступен везде. */
telegramRouter.post('/add-email', requestLimit('telegram-add-email', 6, 60 * 60000, req => req.userId), asyncRoute(async (req, res) => {
  if (!isTelegramOnly(req.userId)) return res.status(409).json({ error: 'У аккаунта уже есть почта или вход через Google' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!isEmailFormatValid(email)) return res.status(400).json({ error: 'Некорректная почта' });
  if (password.length < 6 || password.length > 1024) return res.status(400).json({ error: 'Пароль — от 6 до 1024 символов' });
  if (!(await domainAcceptsMail(email))) return res.status(400).json({ error: 'Такого почтового домена не существует — проверьте адрес' });
  if (db.prepare('SELECT 1 FROM users WHERE email=? AND id<>?').get(email, req.userId))
    return res.status(409).json({ error: 'Эта почта уже используется. Выберите «У меня уже есть аккаунт» при входе, чтобы привязать Telegram к нему.' });
  const prev = db.prepare('SELECT sent_at FROM telegram_pending_email WHERE user_id=?').get(req.userId);
  if (prev && Date.now() - prev.sent_at < EMAIL_COOLDOWN) return res.status(429).json({ error: 'Подождите минуту перед повторной отправкой.' });
  const { salt, hash } = hashPassword(password);
  const code = String(randomInt(100000, 1000000));
  db.prepare(`INSERT INTO telegram_pending_email(user_id,email,pass_hash,pass_salt,code_hash,expires_at,sent_at,attempts) VALUES(?,?,?,?,?,?,?,0)
    ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,pass_hash=excluded.pass_hash,pass_salt=excluded.pass_salt,code_hash=excluded.code_hash,
      expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0`)
    .run(req.userId, email, hash, salt, emailCodeDigest('tgadd' + req.userId, code), Date.now() + EMAIL_TTL, Date.now());
  try { await sendMail(email, 'Disbit — код подтверждения почты', verifyCodeHtml(code)); }
  catch { console.error('[telegram] add-email delivery failed'); return res.status(502).json({ error: 'Не удалось отправить письмо. Повторите позже.' }); }
  res.json({ ok: true });
}));
telegramRouter.post('/add-email/confirm', asyncRoute(async (req, res) => {
  const row = db.prepare('SELECT * FROM telegram_pending_email WHERE user_id=?').get(req.userId);
  if (!row || Date.now() > row.expires_at) return res.status(400).json({ error: 'Код недействителен или истёк' });
  if (row.attempts >= EMAIL_ATTEMPTS) return res.status(429).json({ error: 'Слишком много попыток — запросите новый код' });
  if (emailCodeDigest('tgadd' + req.userId, String(req.body?.code || '').trim()) !== row.code_hash) {
    db.prepare('UPDATE telegram_pending_email SET attempts=attempts+1 WHERE user_id=?').run(req.userId);
    return res.status(400).json({ error: 'Неверный код' });
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT 1 FROM users WHERE email=? AND id<>?').get(row.email, req.userId)) { db.exec('ROLLBACK'); return res.status(409).json({ error: 'Эта почта уже используется' }); }
    db.prepare('UPDATE users SET email=?,pass_hash=?,pass_salt=?,email_verified=1 WHERE id=?').run(row.email, row.pass_hash, row.pass_salt, req.userId);
    db.prepare('DELETE FROM telegram_pending_email WHERE user_id=?').run(req.userId);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.json({ ok: true, user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.userId)) });
}));
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
telegramRouter.patch('/settings', (req, res) => {
  const link = linkByUser(req.userId);
  if (!link) return res.status(404).json({ error: 'Telegram не привязан' });
  const b = req.body || {};
  const set = [], values = [];
  for (const [key, column] of [['remindTime', 'remind_time'], ['quietFrom', 'quiet_from'], ['quietTo', 'quiet_to']]) {
    if (b[key] === undefined) continue;
    if (typeof b[key] !== 'string' || !TIME.test(b[key])) return res.status(400).json({ error: 'Время в формате ЧЧ:ММ' });
    set.push(column + '=?'); values.push(b[key]);
  }
  for (const [key, column] of [['morning', 'notify_morning'], ['evening', 'notify_evening'], ['lastChance', 'notify_last_chance'], ['summary', 'notify_summary'], ['social', 'notify_social']]) {
    if (b.notify?.[key] === undefined) continue;
    if (typeof b.notify[key] !== 'boolean') return res.status(400).json({ error: 'Некорректные поля запроса' });
    set.push(column + '=?'); values.push(b.notify[key] ? 1 : 0);
  }
  if (b.stopped !== undefined) {
    if (typeof b.stopped !== 'boolean') return res.status(400).json({ error: 'Некорректные поля запроса' });
    set.push('stopped=?'); values.push(b.stopped ? 1 : 0);
  }
  if (set.length) db.prepare(`UPDATE telegram_links SET ${set.join(',')} WHERE user_id=?`).run(...values, req.userId);
  res.json({ settings: publicLink(linkByUser(req.userId)) });
});
// Результат requestWriteAccess: при отказе повторный запрос не чаще раза в 7 дней (ТЗ 10).
telegramRouter.post('/write-access', (req, res) => {
  const link = linkByUser(req.userId);
  if (!link) return res.status(404).json({ error: 'Telegram не привязан' });
  if (typeof req.body?.granted !== 'boolean') return res.status(400).json({ error: 'Некорректные поля запроса' });
  db.prepare('UPDATE telegram_links SET write_asked_at=?,can_write=CASE WHEN ?=1 THEN 1 ELSE can_write END WHERE user_id=?')
    .run(Date.now(), req.body.granted ? 1 : 0, req.userId);
  res.json({ settings: publicLink(linkByUser(req.userId)) });
});
telegramRouter.get('/start-param', (req, res) => {
  const param = sanitizeStartParam(req.query.p);
  const m = /^(inv|ck|pr|ch|cr|ad|pf|pn|web)_(.+)$/.exec(param);
  if (!m) return res.json({ kind: 'none' });
  const [, kind, value] = m;
  if (kind === 'inv') {
    const row = db.prepare('SELECT u.login,l.token FROM friend_links l JOIN users u ON u.id=l.user_id WHERE l.token=?').get(value);
    return res.json(row && row.login !== db.prepare('SELECT login FROM users WHERE id=?').get(req.userId)?.login
      ? { kind: 'invite', login: row.login, token: row.token } : { kind: 'none' });
  }
  if (kind === 'ck') {
    const action = /^\d{1,12}$/.test(value) ? db.prepare('SELECT habit_id,day FROM telegram_actions WHERE id=? AND user_id=?').get(Number(value), req.userId) : null;
    return res.json(action ? { kind: 'check', habitId: action.habit_id, day: action.day } : { kind: 'none' });
  }
  res.json({ kind, value });
});
