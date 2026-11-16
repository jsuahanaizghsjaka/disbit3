/* ============================================================
   Друзья — настоящая связь между аккаунтами (не локальный список).
   • Добавление по логину: дружба сразу ВЗАИМНАЯ (пишем обе строки),
     чтобы оба видели друг друга без заявок и подтверждений.
   • Публичная «визитка» друга (имя, аватар, серия, % недели) берётся
     из его user_state — клиент сам публикует туда поле `card`.
     Так сервер не считает стрики повторно и не лезет в чужие обещания.
   Всё требует авторизации: у гостей друзей нет.
   ============================================================ */

import { Router } from 'express';
import { db } from '../db/db.js';
import { blocked } from '../lib/moderation.js';
import { requestLimit } from '../lib/request-limits.js';

const router = Router();

function authRequired(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Нужен аккаунт' });
  next();
}
router.use(authRequired);
db.exec(`CREATE TABLE IF NOT EXISTS friend_requests (
 sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(sender_id,recipient_id));`);
router.post('/',requestLimit('friend-request',20,3600000,req=>req.userId));
// Legacy rows cannot prove either party initiated the relationship.
// Do not turn them into requests: that would let one party confirm for both.
db.exec('DELETE FROM friendships WHERE confirmed=0');

/* Проверка «это твой собственный логин» появилась не сразу — у аккаунтов,
   заведённых до неё, строка «сам себе друг» осталась лежать в базе и вылезала
   в списке и в доске соревнования. Чистим при старте: запрос дешёвый, а вручную
   такое на проде не выловишь. */
db.exec('DELETE FROM friendships WHERE user_id = friend_id');

// публичная часть чужого профиля: только то, что человек сам опубликовал
function publicCard(userId) {
  const row = db.prepare('SELECT data FROM user_state WHERE user_id = ?').get(userId);
  if (!row) return {};
  try {
    const d = JSON.parse(row.data) || {};
    return {
      name: d.profile?.name || null,
      emoji: d.profile?.emoji || null,
      color: d.profile?.color || null,
      streak: d.card?.streak == null ? null : Number(d.card.streak),
      weekPct: d.card?.weekPct ?? null,
      habits: Number(d.card?.habits) || 0,
      // статусы совместных обещаний: { "название": true/false } — только те,
      // что человек сам пометил как общие с другом
      shared: (d.card?.shared && typeof d.card.shared === 'object') ? d.card.shared : {}
    };
  } catch { return {}; }
}

// GET /api/friends — мои друзья с их визитками
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.login FROM friendships f
    JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ? AND f.friend_id <> f.user_id AND f.confirmed=1
    ORDER BY f.created_at DESC
  `).all(req.userId);
  const me = db.prepare('SELECT login FROM users WHERE id = ?').get(req.userId);
  res.json({
    incoming: db.prepare('SELECT u.login FROM friend_requests f JOIN users u ON u.id=f.sender_id WHERE f.recipient_id=?').all(req.userId).filter(r=>{const u=db.prepare('SELECT id FROM users WHERE login=?').get(r.login);return !blocked(req.userId,u.id);}),
    me: me?.login || null,
    friends: rows.filter(r=>!blocked(req.userId,r.id)).map(r => ({ id: r.id, login: r.login, ...publicCard(r.id) }))
  });
});

// POST /api/friends { login } — добавить друга по логину (взаимно)
router.post('/', (req, res) => {
  const login = String(req.body?.login || '').trim().toLowerCase();
  if (!login) return res.status(400).json({ error: 'Укажи логин друга' });

  const friend = db.prepare('SELECT id, login FROM users WHERE login = ?').get(login);
  if (!friend) return res.status(202).json({ok:true,pending:true});
  if (friend.id === req.userId) return res.status(400).json({ error: 'Это твой собственный логин' });
  if (blocked(req.userId,friend.id)) return res.status(403).json({error:'Добавление этого пользователя недоступно'});

  const exists = db.prepare(
    'SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ? AND confirmed=1'
  ).get(req.userId, friend.id);
  if (exists) return res.status(409).json({ error: 'Вы уже друзья' });

  const requested = db.prepare('SELECT 1 FROM friend_requests WHERE sender_id=? AND recipient_id=?').get(friend.id,req.userId);
  if(!requested){db.prepare('INSERT OR IGNORE INTO friend_requests(sender_id,recipient_id) VALUES(?,?)').run(req.userId,friend.id);return res.status(202).json({ok:true,pending:true});}
  const add = db.prepare('INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)');
  add.run(req.userId, friend.id);
  add.run(friend.id, req.userId);        // взаимно — друг тоже видит меня
  db.prepare('UPDATE friendships SET confirmed=1 WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)').run(req.userId,friend.id,friend.id,req.userId);
  db.prepare('DELETE FROM friend_requests WHERE (sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)').run(req.userId,friend.id,friend.id,req.userId);

  res.status(201).json({ ok: true, friend: { id: friend.id, login: friend.login, ...publicCard(friend.id) } });
});

// DELETE /api/friends/:login — удалить дружбу (тоже с обеих сторон)
router.delete('/:login', (req, res) => {
  const login = String(req.params.login || '').trim().toLowerCase();
  const friend = db.prepare('SELECT id FROM users WHERE login = ?').get(login);
  if (!friend) return res.status(404).json({ error: 'Не найден' });
  db.prepare('DELETE FROM friend_requests WHERE (sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)').run(req.userId,friend.id,friend.id,req.userId);
  const del = db.prepare('DELETE FROM friendships WHERE user_id = ? AND friend_id = ?');
  del.run(req.userId, friend.id);
  del.run(friend.id, req.userId);
  res.json({ ok: true });
});

export default router;
