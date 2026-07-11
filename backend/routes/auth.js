/* ============================================================
   Авторизация: регистрация и вход по логину/почте + паролю.
   Пароли — scrypt из node:crypto (без внешних зависимостей),
   сессии — Bearer-токены в таблице sessions.
   ============================================================ */

import { Router } from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from '../db/db.js';

const router = Router();

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
  return { id: row.id, login: row.login, email: row.email, createdAt: row.created_at };
}

/* ---------- валидация ---------- */
const LOGIN_RE = /^[a-zA-Z0-9_.-]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* POST /api/auth/register — { login, email, password } */
router.post('/register', (req, res) => {
  const login = String(req.body?.login || '').trim().toLowerCase();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!LOGIN_RE.test(login)) {
    return res.status(400).json({ error: 'Логин: 3–24 символа, латиница, цифры, . _ -' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Некорректная почта' });
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
  res.status(201).json({ token, user: publicUser(user) });
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
