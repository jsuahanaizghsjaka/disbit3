/* ============================================================
   Авторизация: регистрация и вход по логину/почте + паролю.
   Пароли — scrypt из node:crypto (без внешних зависимостей),
   сессии — Bearer-токены в таблице sessions.
   ============================================================ */

import { Router } from 'express';
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { db } from '../db/db.js';
import { isEmailFormatValid, domainAcceptsMail, sendMail, verifyCodeHtml, mailConfigured } from '../lib/email.js';
import { createSocialAuthRouter } from './social-auth.js';

const router = Router();

/* ---------- подтверждение почты ---------- */
const CODE_TTL_MS = 15 * 60 * 1000;      // код живёт 15 минут
const RESEND_COOLDOWN_MS = 60 * 1000;    // не чаще раза в минуту
const MAX_ATTEMPTS = 6;                  // защита от перебора

function issueCode(userId) {
  const code = String(randomInt(100000, 1000000));   // 6 цифр из криптографического генератора
  db.prepare(`
    INSERT INTO email_codes (user_id, code, expires_at, attempts, sent_at)
    VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      code = excluded.code, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at
  `).run(userId, code, Date.now() + CODE_TTL_MS, Date.now());
  return code;
}

/* ---------- пароли ---------- */
function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, expectedHash) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ---------- сессии ----------
   Токен живёт 90 дней, но окно СКОЛЬЗЯЩЕЕ: пока человек открывает приложение,
   срок сдвигается вперёд. Так активного пользователя не выкидывает посреди
   серии, а забытый на чужом телефоне вход всё-таки протухает.
   Бессрочных токенов быть не должно: украденный работал бы вечно. */
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_MS = 24 * 60 * 60 * 1000;   // продлеваем не чаще раза в сутки

// уборка при старте + срок для сессий, выданных до появления expires_at
// (иначе бета-тестеров разлогинило бы обновлением сервера)
db.prepare('DELETE FROM sessions WHERE expires_at > 0 AND expires_at < ?').run(Date.now());
db.prepare('UPDATE sessions SET expires_at = ? WHERE expires_at = 0').run(Date.now() + SESSION_TTL_MS);

function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, Date.now() + SESSION_TTL_MS);
  return token;
}
function publicUser(row) {
  return {
    id: row.id, login: row.login, email: row.email,
    emailVerified: !!row.email_verified,
    createdAt: row.created_at
  };
}

/* ---------- валидация ---------- */
const LOGIN_RE = /^[a-zA-Z0-9_.-]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* POST /api/auth/register — { login, email, password } */
router.post('/register', async (req, res) => {
  const login = String(req.body?.login || '').trim().toLowerCase();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!LOGIN_RE.test(login)) {
    return res.status(400).json({ error: 'Логин: 3–24 символа, латиница, цифры, . _ -' });
  }
  if (!isEmailFormatValid(email)) {
    return res.status(400).json({ error: 'Некорректная почта' });
  }
  // проверяем, что домен реально принимает почту: регулярка пропускает
  // выдумки вроде «@gmail.fdkjfsk», а MX-запись — нет
  if (!(await domainAcceptsMail(email))) {
    return res.status(400).json({ error: 'Такого почтового домена не существует — проверь адрес' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Пароль — минимум 6 символов' });
  }

  const exists = db.prepare(
    'SELECT id FROM users WHERE login = ? OR email = ?'
  ).get(login, email);
  if (exists) {
    return res.status(409).json({ error: 'Логин или почта уже заняты' });
  }

  const { salt, hash } = hashPassword(password);
  const info = db.prepare(
    'INSERT INTO users (login, email, pass_hash, pass_salt) VALUES (?, ?, ?, ?)'
  ).run(login, email, hash, salt);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = createSession(user.id);

  // шлём код подтверждения; письмо не должно ронять регистрацию
  const code = issueCode(user.id);
  let verificationEmailSent = false;
  try { verificationEmailSent = (await sendMail(email, 'disbit — код подтверждения', verifyCodeHtml(code))).sent === true; }
  catch (e) { console.error('[mail] не удалось отправить:', e.message); }

  res.status(201).json({ token, user: publicUser(user), needVerify: true, verificationEmailSent });
});

/* POST /api/auth/verify — { code } подтвердить почту */
router.post('/verify', (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Не авторизован' });
  const code = String(req.body?.code || '').trim();
  const row = db.prepare('SELECT * FROM email_codes WHERE user_id = ?').get(req.userId);
  if (!row) return res.status(400).json({ error: 'Код не запрашивался — отправь новый' });
  if (row.attempts >= MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Слишком много попыток — запроси новый код' });
  }
  if (Date.now() > row.expires_at) {
    return res.status(400).json({ error: 'Код истёк — запроси новый' });
  }
  if (code !== row.code) {
    db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE user_id = ?').run(req.userId);
    return res.status(400).json({ error: 'Неверный код' });
  }
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(req.userId);
  db.prepare('DELETE FROM email_codes WHERE user_id = ?').run(req.userId);
  res.json({ ok: true, verified: true });
});

/* POST /api/auth/resend — выслать код заново */
router.post('/resend', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Не авторизован' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
  if (user.email_verified) return res.json({ ok: true, verified: true });

  const prev = db.prepare('SELECT sent_at FROM email_codes WHERE user_id = ?').get(req.userId);
  if (prev && Date.now() - prev.sent_at < RESEND_COOLDOWN_MS) {
    const left = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - prev.sent_at)) / 1000);
    return res.status(429).json({ error: `Новый код можно запросить через ${left} с` });
  }
  const code = issueCode(req.userId);
  try {
    const delivery = await sendMail(user.email, 'disbit — код подтверждения', verifyCodeHtml(code));
    res.json({ ok: true, sent: delivery.sent, configured: mailConfigured() });
  } catch (e) {
    console.error('[mail] resend:', e.message);
    res.status(502).json({ error: 'Не удалось отправить письмо — попробуй позже' });
  }
});

/* POST /api/auth/login — { id: логин или почта, password } */
router.post('/login', (req, res) => {
  const id = String(req.body?.id || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!id || !password) {
    return res.status(400).json({ error: 'Укажи логин/почту и пароль' });
  }

  const user = db.prepare(
    'SELECT * FROM users WHERE login = ? OR email = ?'
  ).get(id, id);

  if (!user || !verifyPassword(password, user.pass_salt, user.pass_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  const token = createSession(user.id);
  res.json({ token, user: publicUser(user) });
});

// Kept behind a feature flag until mail delivery and the client flow are verified.
function recoveryLimit(bucket, limit, interval) {
  const now = Date.now();
  db.prepare('DELETE FROM password_reset_limits WHERE window_start < ?').run(now - 24 * 60 * 60 * 1000);
  const row = db.prepare('SELECT window_start, count FROM password_reset_limits WHERE bucket = ?').get(bucket);
  if (!row || now - row.window_start >= interval) {
    db.prepare('INSERT INTO password_reset_limits(bucket,window_start,count) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET window_start=excluded.window_start,count=1').run(bucket, now);
    return true;
  }
  if (row.count >= limit) return false;
  db.prepare('UPDATE password_reset_limits SET count=count+1 WHERE bucket=?').run(bucket);
  return true;
}
router.post('/password-reset/request', async (req, res) => {
  const started = Date.now();
  res.set('Cache-Control', 'no-store');
  if (process.env.PASSWORD_RESET_ENABLED !== '1' || !mailConfigured()) return res.status(503).json({ error: 'Восстановление пароля пока недоступно' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const reply = { ok: true, message: 'Если адрес подтверждён, инструкция будет отправлена на почту.' };
  // Account existence, cooldown and SMTP latency must not affect the response.
  const respond = async () => {
    await delay(Math.max(0, 250 + randomInt(50) - (Date.now() - started)));
    return res.json(reply);
  };
  const ipBucket = createHash('sha256').update(req.ip || '').digest('hex');
  const addressBucket = createHash('sha256').update(email.slice(0, 254)).digest('hex');
  if (!recoveryLimit('request:ip:' + ipBucket, 20, 15 * 60 * 1000) || !recoveryLimit('request:global', 100, 15 * 60 * 1000)) return respond();
  if (!isEmailFormatValid(email)) return respond();
  if (!recoveryLimit('request:' + addressBucket, 3, 60 * 60 * 1000)) return respond();
  const user = db.prepare('SELECT id, email FROM users WHERE email = ? AND email_verified = 1').get(email);
  if (!user) return respond();
  const now = Date.now();
  const existing = db.prepare('SELECT sent_at FROM password_resets WHERE user_id = ?').get(user.id);
  if (existing && now - existing.sent_at < RESEND_COOLDOWN_MS) return respond();
  const token = randomBytes(32).toString('hex');
  const digest = createHash('sha256').update(token).digest('hex');
  db.prepare(`INSERT INTO password_resets(user_id,token_hash,expires_at,sent_at) VALUES(?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,sent_at=excluded.sent_at`)
    .run(user.id, digest, now + CODE_TTL_MS, now);
  sendMail(user.email, 'Disbit — восстановление пароля', `<p>Код восстановления Disbit:</p><p>${token}</p><p>Код действует 15 минут. Если запросили не вы, проигнорируйте это письмо.</p>`)
    .then(result => { if (!result.sent) throw new Error('not sent'); })
    .catch(() => {
      // Do not invalidate a newer request if an older delivery fails late.
      db.prepare('DELETE FROM password_resets WHERE user_id = ? AND token_hash = ?').run(user.id, digest);
      console.error('[mail] password reset delivery failed');
    });
  return respond();
});

router.post('/password-reset/confirm', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (process.env.PASSWORD_RESET_ENABLED !== '1') return res.status(503).json({ error: 'Восстановление пароля пока недоступно' });
  const ipBucket = createHash('sha256').update(req.ip || '').digest('hex');
  if (!recoveryLimit('confirm:ip:' + ipBucket, 30, 15 * 60 * 1000) || !recoveryLimit('confirm:global', 300, 15 * 60 * 1000)) return res.status(429).json({ error: 'Слишком много попыток. Попробуйте через 15 минут.' });
  const token = String(req.body?.token || '');
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!isEmailFormatValid(email) || !/^[a-f0-9]{64}$/.test(token) || password.length < 6 || password.length > 1024) return res.status(400).json({ error: 'Проверьте почту, код и пароль (от 6 до 1024 символов).' });
  const digest = createHash('sha256').update(token).digest('hex');
  const row = db.prepare(`SELECT r.user_id FROM password_resets r JOIN users u ON u.id = r.user_id
    WHERE r.token_hash = ? AND r.expires_at > ? AND u.email = ? AND u.email_verified = 1`).get(digest, Date.now(), email);
  if (!row) return res.status(400).json({ error: 'Код недействителен или истёк' });
  if (req.userId && req.userId !== row.user_id) return res.status(400).json({ error: 'Код недействителен или истёк' });
  const { salt, hash } = hashPassword(password);
  db.exec('BEGIN IMMEDIATE');
  try {
    const consumed = db.prepare('DELETE FROM password_resets WHERE user_id = ? AND token_hash = ? AND expires_at > ?').run(row.user_id, digest, Date.now());
    if (!consumed.changes) { db.exec('ROLLBACK'); return res.status(400).json({ error: 'Код недействителен или истёк' }); }
    db.prepare('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?').run(hash, salt, row.user_id);
    db.prepare('DELETE FROM oauth_results WHERE user_id = ?').run(row.user_id);
    db.prepare('DELETE FROM oauth_flows WHERE user_id = ?').run(row.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return res.json({ ok: true });
});

/* GET /api/auth/me — кто я (по Bearer-токену) */
router.get('/me', (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Не авторизован' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
  res.json({ user: publicUser(user) });
});

/* POST /api/auth/logout — закрыть текущую сессию */
router.post('/logout', (req, res) => {
  const token = req.token;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ ok: true });
});

/* middleware: достаёт пользователя из Authorization: Bearer <token> */
export function authMiddleware(req, res, next) {
  req.userId = null;
  req.token = null;
  const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(req.headers.authorization || '');
  if (m) {
    const now = Date.now();
    const s = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(m[1]);
    if (s && s.expires_at > now) {
      req.userId = s.user_id;
      req.token = m[1];
      // сдвигаем окно, но пишем на диск не чаще раза в сутки: иначе UPDATE
      // уходил бы на КАЖДЫЙ запрос приложения
      if (s.expires_at - now < SESSION_TTL_MS - SESSION_REFRESH_MS) {
        db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?')
          .run(now + SESSION_TTL_MS, m[1]);
      }
    } else if (s) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(m[1]);   // протухла — убираем
    }
  }
  next();
}

router.use('/oauth', createSocialAuthRouter({ db, createSession, publicUser, hashPassword, verifyPassword }));

export default router;
