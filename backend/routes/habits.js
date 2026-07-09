/* ============================================================
   Эндпоинты привычек — теперь на SQLite (db/db.js).
   Структура объекта привычки совпадает с фронтендом
   (frontend/script.js): goal/stake/schedule/history/counts.
   ============================================================ */

import { Router } from 'express';
import { db, rowToHabit, habitToParams } from '../db/db.js';

const router = Router();

// собрать привычку вместе с её отметками
function getHabit(id) {
  const row = db.prepare('SELECT * FROM habits WHERE id = ? AND archived = 0').get(id);
  if (!row) return null;
  const completions = db.prepare('SELECT * FROM completions WHERE habit_id = ?').all(id);
  return rowToHabit(row, completions);
}

// GET /api/habits — список всех привычек с историей
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM habits WHERE archived = 0 ORDER BY created_at').all();
  const stmt = db.prepare('SELECT * FROM completions WHERE habit_id = ?');
  res.json(rows.map(r => rowToHabit(r, stmt.all(r.id))));
});

// POST /api/habits — создать привычку (id может прислать фронтенд)
router.post('/', (req, res) => {
  const p = habitToParams({ id: 'h' + Date.now(), ...req.body });
  try {
    db.prepare(`
      INSERT OR IGNORE INTO habits
        (id, name, icon, color, schedule, goal_type, goal_target, goal_unit,
         stake_mode, stake_amount, stake_recipient, stake_apps, created_day)
      VALUES
        (:id, :name, :icon, :color, :schedule, :goal_type, :goal_target, :goal_unit,
         :stake_mode, :stake_amount, :stake_recipient, :stake_apps, :created_day)
    `).run(p);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  // если фронтенд прислал накопленную историю (первая синхронизация) — сохраняем
  const { history = {}, counts = {} } = req.body;
  const days = new Set([...Object.keys(history), ...Object.keys(counts)]);
  const up = db.prepare(`
    INSERT INTO completions (habit_id, day, count, done) VALUES (?, ?, ?, ?)
    ON CONFLICT(habit_id, day) DO UPDATE SET count = excluded.count, done = excluded.done
  `);
  for (const day of days) {
    up.run(p.id, day, Number(counts[day]) || 0, history[day] ? 1 : 0);
  }

  res.status(201).json(getHabit(p.id));
});

// PUT /api/habits/:id — обновить привычку (прогресс не трогаем)
router.put('/:id', (req, res) => {
  const exists = db.prepare('SELECT id FROM habits WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'Привычка не найдена' });

  const p = habitToParams({ ...req.body, id: req.params.id });   // id менять нельзя
  db.prepare(`
    UPDATE habits SET
      name = :name, icon = :icon, color = :color, schedule = :schedule,
      goal_type = :goal_type, goal_target = :goal_target, goal_unit = :goal_unit,
      stake_mode = :stake_mode, stake_amount = :stake_amount,
      stake_recipient = :stake_recipient, stake_apps = :stake_apps,
      created_day = :created_day
    WHERE id = :id
  `).run(p);

  res.json(getHabit(req.params.id));
});

// PUT /api/habits/:id/day/:day — отметка за день { done, count }
router.put('/:id/day/:day', (req, res) => {
  const exists = db.prepare('SELECT id FROM habits WHERE id = ?').get(req.params.id);
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

// DELETE /api/habits/:id — удалить привычку (отметки удалятся каскадом)
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM habits WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

export default router;
