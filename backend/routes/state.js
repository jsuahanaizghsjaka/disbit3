/* ============================================================
   Синк состояния профиля одним JSON-блобом:
   profile, settings, goals, rewards, friends, backlog, settled.
   Обещания и штрафы ходят своими эндпоинтами — здесь их нет.
   ============================================================ */

import { Router } from 'express';
import { db } from '../db/db.js';

const router = Router();
const uid = req => req.userId;

/* Гостевого пространства больше нет. Раньше здесь стояло `req.userId || 0`, и всё
   записанное до входа падало в общую корзину user_id = 0 — а её мог прочитать
   ЛЮБОЙ запрос без токена. Регистрация в приложении обязательна, гость писать
   на сервер не должен вовсе. */
function authRequired(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Нужен аккаунт' });
  next();
}
router.use(authRequired);

// GET /api/state — блоб пользователя (или data:null, если ещё не сохраняли)
router.get('/', (req, res) => {
  const row = db.prepare(
    'SELECT data, updated_at FROM user_state WHERE user_id = ?'
  ).get(uid(req));
  if (!row) return res.json({ data: null, updatedAt: null });
  let data = null;
  try { data = JSON.parse(row.data); } catch { /* битый блоб — отдаём null */ }
  res.json({ data, updatedAt: row.updated_at });
});

// PUT /api/state — сохранить блоб { data: {...}, ts: <клиентская метка, мс> }
router.put('/', (req, res) => {
  const data = req.body?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ error: 'Нужен объект data' });
  }
  const json = JSON.stringify(data);
  if (json.length > 900_000) {
    return res.status(413).json({ error: 'Слишком большой стейт (лимит ~900КБ)' });
  }
  const ts = String(Number(req.body?.ts) || Date.now());
  db.prepare(`
    INSERT INTO user_state (user_id, data, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(uid(req), json, ts);
  res.json({ ok: true, updatedAt: ts });
});

export default router;
