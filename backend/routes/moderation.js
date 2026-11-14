import { Router } from 'express';
import { db } from '../db/db.js';
import '../lib/moderation.js';
import { adminOnly } from './proofs.js';
const router=Router();
router.get('/appeals/admin',adminOnly,(_req,res)=>res.json({items:db.prepare("SELECT a.*,u.login FROM moderation_appeals a JOIN users u ON u.id=a.user_id WHERE a.status='pending' ORDER BY a.id LIMIT 200").all()}));
router.post('/appeals/:id/decision',adminOnly,(req,res)=>{
 const status=req.body?.status,reason=String(req.body?.reason||'').trim();
 if(!['accepted','rejected'].includes(status)||reason.length<5||reason.length>1000)return res.status(400).json({error:'Укажите решение и причину (5–1000 символов)'});
 db.exec('BEGIN IMMEDIATE');
 try {
 const appeal=db.prepare("SELECT * FROM moderation_appeals WHERE id=? AND status='pending'").get(req.params.id);
 if(!appeal){db.exec('ROLLBACK');return res.status(409).json({error:'Обращение уже рассмотрено или не найдено'});}
 if(status==='accepted')db.prepare('DELETE FROM moderation_bans WHERE user_id=?').run(appeal.user_id);
 db.prepare("UPDATE moderation_appeals SET status=?,decision=?,resolved_at=datetime('now') WHERE id=?").run(status,reason,appeal.id);
 db.prepare('INSERT INTO moderation_notices(user_id,report_id,message) VALUES (?,?,?)').run(appeal.user_id,-appeal.id,(status==='accepted'?'Ограничение снято. ':'Ограничение сохранено. ')+reason);
 db.exec('COMMIT');res.json({ok:true});
 }catch(e){db.exec('ROLLBACK');throw e;}
});
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/reports',adminOnly,(_req,res)=>res.json({items:db.prepare("SELECT r.*,u.login AS target_login FROM content_reports r LEFT JOIN users u ON u.id=r.target_id WHERE r.status='pending' ORDER BY r.created_at LIMIT 200").all()}));
router.post('/reports/:id/decision',adminOnly,(req,res)=>{
 if(!['resolved','dismissed'].includes(req.body?.status)) return res.status(400).json({error:'Некорректное решение'});
 db.exec('BEGIN IMMEDIATE');
 try {
 const report=db.prepare("SELECT * FROM content_reports WHERE id=? AND status='pending'").get(req.params.id);
 if(!report){db.exec('ROLLBACK');return res.status(409).json({error:'Жалоба не найдена или уже рассмотрена'});}
 if(req.body.status==='resolved' && report.target_id){
  db.prepare('INSERT OR REPLACE INTO moderation_bans(user_id,reason) VALUES (?,?)').run(report.target_id,'Нарушение правил контента');
  db.prepare('DELETE FROM friendships WHERE user_id=? OR friend_id=?').run(report.target_id,report.target_id);
  db.prepare('DELETE FROM habit_invites WHERE owner_id=?').run(report.target_id);
 }
 db.prepare("UPDATE content_reports SET status=?,resolved_at=datetime('now') WHERE id=?").run(req.body.status,req.params.id);
 if(report.reporter_id)db.prepare('INSERT INTO moderation_notices(user_id,report_id,message) VALUES (?,?,?)').run(report.reporter_id,report.id,req.body.status==='resolved'?'Жалоба рассмотрена: социальные действия пользователя ограничены.':'Жалоба рассмотрена: нарушение не подтверждено. Обжалование: disbitx1@gmail.com');
 db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 res.json({ok:true});
});
router.use((req,res,next)=>req.userId?next():res.status(401).json({error:'Нужен аккаунт'}));
router.get('/restriction',(req,res)=>res.json({restriction:db.prepare('SELECT reason,created_at FROM moderation_bans WHERE user_id=?').get(req.userId)||null,appeal:db.prepare('SELECT status,decision FROM moderation_appeals WHERE user_id=? ORDER BY id DESC LIMIT 1').get(req.userId)||null}));
router.post('/appeals',(req,res)=>{
 const message=String(req.body?.message||'').trim();
 if(message.length<5||message.length>1000)return res.status(400).json({error:'Опишите обращение: 5–1000 символов'});
 if(!db.prepare('SELECT 1 FROM moderation_bans WHERE user_id=?').get(req.userId))return res.status(409).json({error:'Ограничений нет'});
 if(db.prepare("SELECT 1 FROM moderation_appeals WHERE user_id=? AND (status='pending' OR created_at>datetime('now','-1 day'))").get(req.userId))return res.status(409).json({error:'Обращение уже принято. Повторное доступно через сутки после предыдущего и после решения.'});
 db.prepare('INSERT INTO moderation_appeals(user_id,message) VALUES (?,?)').run(req.userId,message);res.status(201).json({ok:true});
});
router.get('/notices',(req,res)=>res.json({items:db.prepare('SELECT id,report_id,message,created_at FROM moderation_notices WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.userId)}));
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
