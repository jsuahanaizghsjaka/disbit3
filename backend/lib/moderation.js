import { db } from '../db/db.js';
db.exec(`CREATE TABLE IF NOT EXISTS moderation_appeals (
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',decision TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),resolved_at TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS one_pending_appeal ON moderation_appeals(user_id) WHERE status='pending';`);
db.exec(`CREATE TABLE IF NOT EXISTS moderation_bans (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS moderation_notices (
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 report_id INTEGER NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(user_id,report_id));`);
export function enforceModeration(req,res,next) {
 if(!req.userId || !db.prepare('SELECT 1 FROM moderation_bans WHERE user_id=?').get(req.userId))return next();
 // Keep access to export, erasure, financial obligations and the appeal channel.
 if(/^\/api\/(auth|account|wallet)(\/|$)/.test(req.path)||req.path==='/api/moderation/appeals'||req.method==='GET')return next();
 // Do not prevent fulfilling personal promises or using a proof skip.
 // Moderation must not itself cause a missed promise or financial penalty.
 if(!/^\/api\/(friends|invites)(\/|$)/.test(req.path) && req.path!=='/api/proofs' && req.path!=='/api/proofs/')return next();
 return res.status(403).json({error:'Публикация и социальные действия ограничены модератором. Обжалование: disbitx1@gmail.com',code:'ACCOUNT_RESTRICTED'});
}
db.exec(`CREATE TABLE IF NOT EXISTS user_blocks (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id,target_id));
CREATE TABLE IF NOT EXISTS content_reports (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 target_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 proof_id INTEGER, reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','dismissed')),
 created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT);`);
export function blocked(a,b) {
 if(db.prepare('SELECT 1 FROM moderation_bans WHERE user_id IN (?,?)').get(a,b))return true;
 return !!db.prepare('SELECT 1 FROM user_blocks WHERE (user_id=? AND target_id=?) OR (user_id=? AND target_id=?)').get(a,b,b,a);
}
