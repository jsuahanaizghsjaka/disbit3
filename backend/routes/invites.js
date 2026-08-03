/* ============================================================
   Приглашения «делать обещание вместе»: короткий код → ссылка и QR.
   • Владелец получает код для своего обещания (один и тот же при повторных
     запросах — ссылку можно переслать хоть когда).
   • Друг открывает ссылку → видит, что за обещание и кто зовёт → принимает.
     При принятии: заводится взаимная дружба, у друга создаётся ТАКАЯ ЖЕ
     обещание, и у обоих проставляется buddy — карточки связываются.
   ============================================================ */

import { Router } from 'express';
import crypto from 'node:crypto';
import { db, habitToParams, rowToHabit } from '../db/db.js';

const router = Router();

// снимок обещания, который переносим другу (прогресс НЕ переносим)
function snapshot(h) {
  return {
    name: h.name, icon: h.icon, color: h.color,
    schedule: h.schedule, weekTarget: h.week_target,
    goal_type: h.goal_type, goal_target: h.goal_target, goal_unit: h.goal_unit,
    stake_mode: h.stake_mode, stake_amount: h.stake_amount,
    stake_recipient: h.stake_recipient, stake_apps: h.stake_apps, stake_minutes: h.stake_minutes
  };
}

// POST /api/invites { habitId } — получить код приглашения для своего обещания
router.post('/', (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Нужен аккаунт' });
  const habitId = String(req.body?.habitId || '');
  const h = db.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').get(habitId, req.userId);
  if (!h) return res.status(404).json({ error: 'Обещание не найдена' });

  const existing = db.prepare(
    'SELECT code FROM habit_invites WHERE owner_id = ? AND habit_id = ?'
  ).get(req.userId, habitId);
  if (existing) {
    // обновляем снимок — вдруг обещание переименовали после прошлой ссылки
    db.prepare('UPDATE habit_invites SET payload = ? WHERE code = ?')
      .run(JSON.stringify(snapshot(h)), existing.code);
    return res.json({ code: existing.code, name: h.name });
  }

  const code = crypto.randomBytes(5).toString('hex');   // 10 символов — коротко для QR
  db.prepare(`
    INSERT INTO habit_invites (code, owner_id, habit_id, payload) VALUES (?, ?, ?, ?)
  `).run(code, req.userId, habitId, JSON.stringify(snapshot(h)));
  res.status(201).json({ code, name: h.name });
});

// GET /api/invites/:code — что за приглашение (открыто, без входа: показать превью)
router.get('/:code', (req, res) => {
  const inv = db.prepare('SELECT * FROM habit_invites WHERE code = ?').get(req.params.code);
  if (!inv) return res.status(404).json({ error: 'Приглашение не найдено' });
  const owner = db.prepare('SELECT login FROM users WHERE id = ?').get(inv.owner_id);
  let p = {};
  try { p = JSON.parse(inv.payload); } catch {}
  res.json({ code: inv.code, owner: owner?.login || null, name: p.name || 'Обещание', icon: p.icon || null });
});

// POST /api/invites/:code/accept — принять: дружба + такое же обещание + связка buddy
router.post('/:code/accept', (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Нужен аккаунт' });
  const inv = db.prepare('SELECT * FROM habit_invites WHERE code = ?').get(req.params.code);
  if (!inv) return res.status(404).json({ error: 'Приглашение не найдено' });
  if (inv.owner_id === req.userId) return res.status(400).json({ error: 'Это твоё собственное приглашение' });

  const owner = db.prepare('SELECT id, login FROM users WHERE id = ?').get(inv.owner_id);
  const me = db.prepare('SELECT id, login FROM users WHERE id = ?').get(req.userId);
  if (!owner) return res.status(404).json({ error: 'Автор приглашения не найден' });

  // 1. дружба (взаимно)
  const addF = db.prepare('INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)');
  addF.run(me.id, owner.id);
  addF.run(owner.id, me.id);

  // 2. такое же обещание у принявшего (если такой ещё нет — сверяем по названию)
  let p = {};
  try { p = JSON.parse(inv.payload); } catch {}
  const already = db.prepare(
    'SELECT id FROM habits WHERE user_id = ? AND lower(name) = lower(?) AND archived = 0'
  ).get(me.id, p.name || '');

  let myHabitId = already?.id;
  if (!myHabitId) {
    myHabitId = 'h' + Date.now();
    const params = habitToParams({
      id: myHabitId,
      name: p.name, icon: p.icon, color: p.color,
      schedule: p.schedule ? JSON.parse(p.schedule) : [0,1,2,3,4,5,6],
      weekTarget: p.weekTarget || 0,
      buddy: owner.login,
      goal: { type: p.goal_type, target: p.goal_target, unit: p.goal_unit },
      stake: p.stake_mode === 'lock'
        ? { mode: 'lock', apps: p.stake_apps ? JSON.parse(p.stake_apps) : [], minutes: p.stake_minutes }
        : { mode: 'money', amount: p.stake_amount, recipient: p.stake_recipient },
      createdAt: new Date().toISOString().slice(0, 10)
    });
    db.prepare(`
      INSERT INTO habits
        (id, user_id, name, icon, color, schedule, week_target, buddy, pinned, goal_type, goal_target, goal_unit,
         stake_mode, stake_amount, stake_recipient, stake_apps, stake_minutes, created_day)
      VALUES
        (:id, :user_id, :name, :icon, :color, :schedule, :week_target, :buddy, :pinned, :goal_type, :goal_target, :goal_unit,
         :stake_mode, :stake_amount, :stake_recipient, :stake_apps, :stake_minutes, :created_day)
    `).run({ ...params, user_id: me.id });
  } else {
    db.prepare('UPDATE habits SET buddy = ? WHERE id = ?').run(owner.login, myHabitId);
  }

  // 3. у владельца обещание тоже становится совместной — со мной
  db.prepare('UPDATE habits SET buddy = ? WHERE id = ? AND user_id = ?')
    .run(me.login, inv.habit_id, owner.id);

  const row = db.prepare('SELECT * FROM habits WHERE id = ?').get(myHabitId);
  res.json({
    ok: true,
    owner: owner.login,
    created: !already,                  // false — обещание было, просто связали
    habit: row ? rowToHabit(row, []) : null
  });
});

export default router;
