import { db } from '../db/db.js';
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
 return !!db.prepare('SELECT 1 FROM user_blocks WHERE (user_id=? AND target_id=?) OR (user_id=? AND target_id=?)').get(a,b,b,a);
}
