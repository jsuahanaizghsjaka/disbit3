/* ============================================================
   Эндпоинты привычек — SQLite (db/db.js), данные привязаны
   к пользователю. Без токена работаешь в гостевом пространстве
   (user_id = 0), с Bearer-токеном — в своём.
   ============================================================ */

import { Router } from 'express';
import { db, rowToHabit, habitToParams } from '../db/db.js';

const router = Router();
const uid = req => req.userId || 0;   // гость = 0 (id никогда не достаётся юзерам)

function getHabit(id, userId) {
  const row = db.prepare(
    'SELECT * FROM habits WHERE id = ? AND user_id = ? AND archived = 0'
  ).get(id, userId);
  if (!row) return null;
  const completions = db.prepare('SELECT * FROM completions WHERE habit_id = ?').all(id);
  return rowToHabit(row, completions);
}

// GET /api/habits — список привычек пользователя с историей
router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM habits WHERE user_id = ? AND archived = 0 ORDER BY created_at'
  ).all(uid(req));
  const stmt = db.prepare('SELECT * FROM completions WHERE habit_id = ?');
  res.json(rows.map(r => rowToHabit(r, stmt.all(r.id))));
});

// POST /api/habits — создать привычку (id может прислать фронтенд)
router.post('/', (req, res) => {
  const p = habitToParams({ id: 'h' + Date.now(), ...req.body });
  try {
    db.prepare(`
      INSERT OR IGNORE INTO habits
        (id, user_id, name, icon, color, schedule, week_target, pinned, goal_type, goal_target, goal_unit,
         stake_mode, stake_amount, stake_recipient, stake_apps, stake_minutes, created_day)
      VALUES
        (:id, :user_id, :name, :icon, :color, :schedule, :week_target, :pinned, :goal_type, :goal_target, :goal_unit,
         :stake_mode, :stake_amount, :stake_recipient, :stake_apps, :stake_minutes, :created_day)
    `).run({ ...p, user_id: uid(req) });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  // накопленная история от фронтенда (первая синхронизация)
  const { history = {}, counts = {} } = req.body;
  const days = new Set([...Object.keys(history), ...Object.keys(counts)]);
  const up = db.prepare(`
    INSERT INTO completions (habit_id, day, count, done) VALUES (?, ?, ?, ?)
    ON CONFLICT(habit_id, day) DO UPDATE SET count = excluded.count, done = excluded.done
  `);
  for (const day of days) {
    up.run(p.id, day, Number(counts[day]) || 0, history[day] ? 1 : 0);
  }

  res.status(201).json(getHabit(p.id, uid(req)));
});

// PUT /api/habits/:id — обновить привычку (прогресс не трогаем)
router.put('/:id', (req, res) => {
  const exists = db.prepare(
    'SELECT id FROM habits WHERE id = ? AND user_id = ?'
  ).get(req.params.id, uid(req));
  if (!exists) return res.status(404).json({ error: 'Привычка не найдена' });

  const p = habitToParams({ ...req.body, id: req.params.id });
  db.prepare(`
    UPDATE habits SET
      name = :name, icon = :icon, color = :color, schedule = :schedule, week_target = :week_target, pinned = :pinned,
      goal_type = :goal_type, goal_target = :goal_target, goal_unit = :goal_unit,
      stake_mode = :stake_mode, stake_amount = :stake_amount,
      stake_recipient = :stake_recipient, stake_apps = :stake_apps, stake_minutes = :stake_minutes,
      created_day = :created_day
    WHERE id = :id
  `).run(p);

  res.json(getHabit(req.params.id, uid(req)));
});

// PUT /api/habits/:id/day/:day — отметка за день { done, count }
router.put('/:id/day/:day', (req, res) => {
  const exists = db.prepare(
    'SELECT id FROM habits WHERE id = ? AND user_id = ?'
  ).get(req.params.id, uid(req));
  if (!exists) return res.status(404).json({ error: 'Привычка не найдена' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.day)) {
    return res.status(400).json({ error: 'Неверный формат дня, нужен YYYY-MM-DD' });
  }

  const done = req.body?.done ? 1 : 0;
  const count = Number(req.body?.count) || 0;
  db.prepare(`
    INSERT INTO completions (habit_id, day, count, done) VALUES (?, ?, ?, ?)
    ON CONFLICT(habit_id, day) DO UPDATE SET count = excluded.count, done = excluded.done
  `).run(req.params.id, req.params.day, count, done);

  res.json({ ok: true, day: req.params.day, done: !!done, count });
});

// DELETE /api/habits/:id — удалить привычку (отметки — каскадом)
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM habits WHERE id = ? AND user_id = ?')
    .run(req.params.id, uid(req));
  res.status(204).end();
});

export default router;
