/* ============================================================
   Эндпоинты обещаний — SQLite (db/db.js), данные привязаны
   к пользователю. Все маршруты требуют Bearer-токен: данные строго свои.
   ============================================================ */

import { Router } from 'express';
import { db, rowToHabit, habitToParams } from '../db/db.js';
import { accountDay, proofSatisfied } from '../proof-policy.js';

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

function getHabit(id, userId) {
  const row = db.prepare(
    'SELECT * FROM habits WHERE id = ? AND user_id = ?'
  ).get(id, userId);
  if (!row) return null;
  const completions = db.prepare('SELECT * FROM completions WHERE habit_id = ?').all(id);
  return rowToHabit(row, completions);
}

// GET /api/habits — список обещаний пользователя с историей
router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM habits WHERE user_id = ?' + (req.query.includeArchived === '1' ? '' : ' AND archived = 0') + ' ORDER BY created_at'
  ).all(uid(req));
  const stmt = db.prepare('SELECT * FROM completions WHERE habit_id = ?');
  res.json(rows.map(r => rowToHabit(r, stmt.all(r.id))));
});

// POST /api/habits — создать обещание (id может прислать фронтенд)
router.post('/', (req, res) => {
  if (req.body?.stake?.mode === 'lock') {
    return res.status(422).json({ error: 'Блокировка приложений пока не поддерживается' });
  }
  const p = habitToParams({ id: 'h' + Date.now(), ...req.body });
  if (db.prepare('SELECT id FROM habits WHERE id=?').get(p.id)) {
    return res.status(409).json({ error: 'Обещание с этим id уже существует' });
  }
  if (Object.keys(req.body.history || {}).length || Object.keys(req.body.counts || {}).length) {
    return res.status(422).json({ error: 'Импорт отметок закрыт. Создай обещание без истории, отмечать можно только сегодня.' });
  }
  try {
    db.prepare(`
      INSERT OR IGNORE INTO habits
        (id, user_id, name, icon, color, schedule, week_target, buddy, pinned, goal_type, goal_target, goal_unit,
         stake_mode, stake_amount, stake_recipient, stake_apps, stake_minutes, created_day, minimum_action)
      VALUES
        (:id, :user_id, :name, :icon, :color, :schedule, :week_target, :buddy, :pinned, :goal_type, :goal_target, :goal_unit,
         :stake_mode, :stake_amount, :stake_recipient, :stake_apps, :stake_minutes, :created_day, :minimum_action)
    `).run({ ...p, user_id: uid(req) });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  res.status(201).json(getHabit(p.id, uid(req)));
});

// Archive is a pause, not deletion. Existing completions and charges are immutable.
// Periods are [from, to): restoring today resumes obligations today, not in the gap.
router.put('/:id/archive', (req, res) => {
  const row = db.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').get(req.params.id, uid(req));
  if (!row) return res.status(404).json({ error: 'Обещание не найдено' });
  const { archived, day } = req.body || {};
  if (typeof archived !== 'boolean' || typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      day !== accountDay(req)) return res.status(400).json({ error: 'Нужны состояние архива и сегодняшний день' });
  if (!!row.archived !== archived) {
    const periods = JSON.parse(row.archive_periods || '[]');
    const last = periods.at(-1);
    if (last && day < (last.to || last.from)) return res.status(409).json({ error: 'Проверь дату на устройстве' });
    if (archived) periods.push({ from: day, to: null });
    else if (last && last.to === null) last.to = day;
    db.prepare('UPDATE habits SET archived = ?, archive_periods = ? WHERE id = ? AND user_id = ?')
      .run(archived ? 1 : 0, JSON.stringify(periods), row.id, uid(req));
  }
  res.json(getHabit(row.id, uid(req)));
});

// PUT /api/habits/:id — обновить обещание (прогресс не трогаем)
router.put('/:id', (req, res) => {
  const exists = db.prepare(
    'SELECT id, stake_mode FROM habits WHERE id = ? AND user_id = ?'
  ).get(req.params.id, uid(req));
  if (!exists) return res.status(404).json({ error: 'Обещание не найдена' });
  if (req.body?.stake?.mode === 'lock' && exists.stake_mode !== 'lock') {
    return res.status(422).json({ error: 'Блокировка приложений пока не поддерживается' });
  }

  const p = habitToParams({ ...req.body, id: req.params.id });
  db.prepare(`
    UPDATE habits SET
      name = :name, icon = :icon, color = :color, schedule = :schedule, week_target = :week_target, buddy = :buddy, pinned = :pinned,
      goal_type = :goal_type, goal_target = :goal_target, goal_unit = :goal_unit,
      stake_mode = :stake_mode, stake_amount = :stake_amount,
      stake_recipient = :stake_recipient, stake_apps = :stake_apps, stake_minutes = :stake_minutes,
      created_day = :created_day, minimum_action = :minimum_action
    WHERE id = :id
  `).run(p);

  res.json(getHabit(req.params.id, uid(req)));
});

// PUT /api/habits/:id/day/:day — отметка за день { done, count }
router.put('/:id/day/:day', (req, res) => {
  const exists = db.prepare(
    'SELECT id, archive_periods, goal_type, goal_target FROM habits WHERE id = ? AND user_id = ?'
  ).get(req.params.id, uid(req));
  if (!exists) return res.status(404).json({ error: 'Обещание не найдена' });
  if (JSON.parse(exists.archive_periods || '[]').some(p => req.params.day >= p.from && (!p.to || req.params.day < p.to))) {
    return res.status(409).json({ error: 'В этот день обещание было в архиве' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.day)) {
    return res.status(400).json({ error: 'Неверный формат дня, нужен YYYY-MM-DD' });
  }
  if (req.params.day !== accountDay(req)) {
    return res.status(403).json({ error: 'День закрыт: отмечать можно только сегодня' });
  }

  const skip = req.body?.skip ? 1 : 0;
  const done = (!skip && req.body?.done) ? 1 : 0;   // пропуск и «выполнено» взаимоисключаемы
  const count = Math.max(0, Math.min(999, Math.trunc(Number(req.body?.count) || 0)));
  if ((done || (!skip && exists.goal_type === 'count' && count >= exists.goal_target)) &&
      !proofSatisfied(uid(req), exists.id, req.params.day)) {
    return res.status(409).json({ error: 'Нужно фото/видео или один из пяти пропусков пруфа за месяц' });
  }
  db.prepare(`
    INSERT INTO completions (habit_id, day, count, done, skip, minimum) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(habit_id, day) DO UPDATE SET count = excluded.count, done = excluded.done, skip = excluded.skip, minimum = excluded.minimum
  `).run(req.params.id, req.params.day, count, done, skip, done && req.body.minimum ? 1 : 0);

  res.json({ ok: true, day: req.params.day, done: !!done, skip: !!skip, count });
});

// DELETE /api/habits/:id — удалить обещание (отметки — каскадом)
router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM habits WHERE id = ? AND user_id = ?')
    .run(req.params.id, uid(req));
  // Чужое обещание фильтр по user_id и так не тронет, но раньше ответ был 204
  // «удалено» — клиент не отличал успех от промаха. PUT и отметка дня в этом
  // случае отвечают 404; делаем так же.
  if (!info.changes) return res.status(404).json({ error: 'Обещание не найдено' });
  res.status(204).end();
});

export default router;
