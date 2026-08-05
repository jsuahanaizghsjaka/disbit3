/* ============================================================
   Эндпоинты обещаний — SQLite (db/db.js), данные привязаны
   к пользователю. Все маршруты требуют Bearer-токен: данные строго свои.
   ============================================================ */

import { Router } from 'express';
import { db, rowToHabit, habitToParams } from '../db/db.js';

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
    'SELECT * FROM habits WHERE id = ? AND user_id = ? AND archived = 0'
  ).get(id, userId);
  if (!row) return null;
  const completions = db.prepare('SELECT * FROM completions WHERE habit_id = ?').all(id);
  return rowToHabit(row, completions);
}

// GET /api/habits — список обещаний пользователя с историей
router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM habits WHERE user_id = ? AND archived = 0 ORDER BY created_at'
  ).all(uid(req));
  const stmt = db.prepare('SELECT * FROM completions WHERE habit_id = ?');
  res.json(rows.map(r => rowToHabit(r, stmt.all(r.id))));
});

// POST /api/habits — создать обещание (id может прислать фронтенд)
router.post('/', (req, res) => {
  const p = habitToParams({ id: 'h' + Date.now(), ...req.body });
  try {
    db.prepare(`
      INSERT OR IGNORE INTO habits
        (id, user_id, name, icon, color, schedule, week_target, buddy, pinned, goal_type, goal_target, goal_unit,
         stake_mode, stake_amount, stake_recipient, stake_apps, stake_minutes, created_day)
      VALUES
        (:id, :user_id, :name, :icon, :color, :schedule, :week_target, :buddy, :pinned, :goal_type, :goal_target, :goal_unit,
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

// PUT /api/habits/:id — обновить обещание (прогресс не трогаем)
router.put('/:id', (req, res) => {
  const exists = db.prepare(
    'SELECT id FROM habits WHERE id = ? AND user_id = ?'
  ).get(req.params.id, uid(req));
  if (!exists) return res.status(404).json({ error: 'Обещание не найдена' });

  const p = habitToParams({ ...req.body, id: req.params.id });
  db.prepare(`
    UPDATE habits SET
      name = :name, icon = :icon, color = :color, schedule = :schedule, week_target = :week_target, buddy = :buddy, pinned = :pinned,
      goal_type = :goal_type, goal_target = :goal_target, goal_unit = :goal_unit,
      stake_mode = :stake_mode, stake_amount = :stake_amount,
      stake_recipient = :stake_recipient, stake_apps = :stake_apps, stake_minutes = :stake_minutes,
      created_day = :created_day
    WHERE id = :id
  `).run(p);

  res.json(getHabit(req.params.id, uid(req)));
});

/* Окно правок: сегодня и вчера, дальше в прошлое нельзя. Приложение таких
   кнопок уже не показывает, но проверка обязана стоять и здесь — иначе запрет
   обходится одним запросом мимо интерфейса, и серия собирается задним числом,
   когда штрафы за пропуски давно начислены.

   Запас в сутки с каждой стороны — из-за часовых поясов: у телефона в UTC+14
   «сегодня» наступает раньше серверного UTC, у UTC−12 — позже, и его честное
   «вчера» приходится на позавчера по UTC. */
function dayShift(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

// PUT /api/habits/:id/day/:day — отметка за день { done, count }
router.put('/:id/day/:day', (req, res) => {
  const exists = db.prepare(
    'SELECT id FROM habits WHERE id = ? AND user_id = ?'
  ).get(req.params.id, uid(req));
  if (!exists) return res.status(404).json({ error: 'Обещание не найдена' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.day)) {
    return res.status(400).json({ error: 'Неверный формат дня, нужен YYYY-MM-DD' });
  }
  if (req.params.day > dayShift(1) || req.params.day < dayShift(-2)) {
    return res.status(403).json({ error: 'День закрыт: отмечать можно только сегодня и вчера' });
  }

  const skip = req.body?.skip ? 1 : 0;
  const done = (!skip && req.body?.done) ? 1 : 0;   // пропуск и «выполнено» взаимоисключаемы
  const count = Number(req.body?.count) || 0;
  db.prepare(`
    INSERT INTO completions (habit_id, day, count, done, skip) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(habit_id, day) DO UPDATE SET count = excluded.count, done = excluded.done, skip = excluded.skip
  `).run(req.params.id, req.params.day, count, done, skip);

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
