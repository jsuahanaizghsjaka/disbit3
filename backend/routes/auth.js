/* ============================================================
   Авторизация: регистрация и вход по логину/почте + паролю.
   Пароли — scrypt из node:crypto (без внешних зависимостей),
   сессии — Bearer-токены в таблице sessions.
   ============================================================ */

import { Router } from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from '../db/db.js';
import { isEmailFormatValid, domainAcceptsMail, sendMail, verifyCodeHtml, mailConfigured } from '../lib/email.js';

const router = Router();

/* ---------- подтверждение почты ---------- */
const CODE_TTL_MS = 15 * 60 * 1000;      // код живёт 15 минут
const RESEND_COOLDOWN_MS = 60 * 1000;    // не чаще раза в минуту
const MAX_ATTEMPTS = 6;                  // защита от перебора

function issueCode(userId) {
  const code = String(Math.floor(100000 + Math.random() * 900000));   // 6 цифр
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

/* ---------- сессии ---------- */
function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
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
  try { await sendMail(email, 'disbit — код подтверждения', verifyCodeHtml(code)); }
  catch (e) { console.error('[mail] не удалось отправить:', e.message); }

  res.status(201).json({ token, user: publicUser(user), needVerify: true });
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
    await sendMail(user.email, 'disbit — код подтверждения', verifyCodeHtml(code));
    res.json({ ok: true, sent: true, configured: mailConfigured() });
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
    const s = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(m[1]);
    if (s) {
      req.userId = s.user_id;
      req.token = m[1];
    }
  }
  next();
}

export default router;
