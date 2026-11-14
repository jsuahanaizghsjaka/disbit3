import { Router } from 'express';
import { db } from '../db/db.js';
import '../lib/moderation.js';
import { adminOnly } from './proofs.js';
const router=Router();
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/reports',adminOnly,(_req,res)=>res.json({items:db.prepare("SELECT r.*,u.login AS target_login FROM content_reports r LEFT JOIN users u ON u.id=r.target_id WHERE r.status='pending' ORDER BY r.created_at LIMIT 200").all()}));
router.post('/reports/:id/decision',adminOnly,(req,res)=>{
 if(!['resolved','dismissed'].includes(req.body?.status)) return res.status(400).json({error:'Некорректное решение'});
 const result=db.prepare("UPDATE content_reports SET status=?,resolved_at=datetime('now') WHERE id=? AND status='pending'").run(req.body.status,req.params.id);
 if(!result.changes) return res.status(409).json({error:'Жалоба не найдена или уже рассмотрена'});
 res.json({ok:true});
});
router.use((req,res,next)=>req.userId?next():res.status(401).json({error:'Нужен аккаунт'}));
router.get('/blocks',(req,res)=>res.json({items:db.prepare('SELECT u.login FROM user_blocks b JOIN users u ON u.id=b.target_id WHERE b.user_id=?').all(req.userId)}));
router.post('/blocks',(req,res)=>{
 const target=db.prepare('SELECT id FROM users WHERE login=?').get(String(req.body?.login || '').trim().toLowerCase());
 if(!target || target.id===req.userId) return res.status(400).json({error:'Укажи логин другого пользователя'});
 db.exec('BEGIN IMMEDIATE');
 try {
  db.prepare('INSERT OR IGNORE INTO user_blocks VALUES (?,?)').run(req.userId,target.id);
  db.prepare('DELETE FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)').run(req.userId,target.id,target.id,req.userId);
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 res.json({ok:true});
});
router.delete('/blocks/:login',(req,res)=>{db.prepare('DELETE FROM user_blocks WHERE user_id=? AND target_id IN (SELECT id FROM users WHERE login=?)').run(req.userId,req.params.login);res.json({ok:true});});
router.post('/reports',(req,res)=>{
 const reason=String(req.body?.reason || '').trim();
 if(reason.length<5 || reason.length>1000) return res.status(400).json({error:'Опиши причину: от 5 до 1000 символов'});
 if(db.prepare("SELECT count(*) AS n FROM content_reports WHERE reporter_id=? AND created_at>datetime('now','-1 day')").get(req.userId).n>=10) return res.status(429).json({error:'Не больше 10 жалоб за сутки'});
 const target=db.prepare('SELECT id FROM users WHERE login=?').get(String(req.body?.login || '').trim().toLowerCase());
 if(!target || target.id===req.userId) return res.status(400).json({error:'Укажи логин другого пользователя'});
 // Proofs are private to their author and moderator; they are not a public feed.
 if(req.body?.proofId != null) return res.status(400).json({error:'По вопросу своего пруфа обратись в поддержку. Чужие пруфы недоступны.'});
 const item=db.prepare('INSERT INTO content_reports(reporter_id,target_id,reason) VALUES (?,?,?)').run(req.userId,target.id,reason);
 res.status(201).json({ok:true,id:Number(item.lastInsertRowid),responseHours:48});
});
export default router;
