/* ============================================================
   Эндпоинты журнала списаний (автоитог дня).
   Пока все записи со статусом 'simulated' — реальные платежи
   появятся вместе со Stripe/ЮKassa.
   ============================================================ */

import { Router } from 'express';
import { db } from '../db/db.js';

const router = Router();

// строка БД → объект журнала на фронтенде
function rowToEntry(r) {
  return {
    day: r.day,
    habitId: r.habit_id,
    name: r.name,
    icon: r.icon,
    mode: r.mode,
    amount: r.amount,
    recipient: r.recipient,
    apps: JSON.parse(r.apps || '[]'),
    status: r.status
  };
}

const uid = req => req.userId || 0;   // гость = 0 (id никогда не достаётся юзерам)

// GET /api/charges — журнал пользователя (старые сначала, как на фронтенде)
router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM charges WHERE user_id = ? ORDER BY day, id'
  ).all(uid(req));
  res.json(rows.map(rowToEntry));
});

// POST /api/charges — записать пачку штрафов (автоитог за прошедшие дни)
// Дубликаты (та же привычка + день) тихо пропускаются.
router.post('/', (req, res) => {
  const entries = Array.isArray(req.body) ? req.body : [req.body];
  const ins = db.prepare(`
    INSERT OR IGNORE INTO charges (user_id, habit_id, day, name, icon, mode, amount, recipient, apps)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let added = 0;
  for (const e of entries) {
    if (!e?.habitId || !e?.day) continue;
    const r = ins.run(
      uid(req), String(e.habitId), String(e.day), e.name || '', e.icon || '',
      e.mode === 'lock' ? 'lock' : 'money',
      Number(e.amount) || 0, e.recipient || null,
      JSON.stringify(e.apps || [])
    );
    added += r.changes;
  }
  res.status(201).json({ ok: true, added });
});

export default router;
