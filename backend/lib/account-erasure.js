import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const fingerprint = user => createHash('sha256').update(JSON.stringify([user.id,user.created_at,user.login,user.email])).digest('hex');
export function ensureErasureTables(db) {
 db.exec(`CREATE TABLE IF NOT EXISTS account_media_cleanup(file TEXT PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS account_deletion_requests(user_id INTEGER PRIMARY KEY,created_at TEXT DEFAULT (datetime('now')),status TEXT NOT NULL DEFAULT 'awaiting_financial_resolution');`);
}
export function financialState(db,id) {
 const account=db.prepare('SELECT balance,reserved FROM money_accounts WHERE user_id=?').get(id);
 const pending=db.prepare("SELECT 1 FROM money_payment_intents WHERE user_id=? AND status IN ('created','pending') UNION ALL SELECT 1 FROM money_refund_requests WHERE user_id=? AND status IN ('pending','partial') LIMIT 1").get(id,id);
 const history=db.prepare('SELECT 1 FROM money_ledger WHERE user_id=? UNION ALL SELECT 1 FROM money_payment_intents WHERE user_id=? UNION ALL SELECT 1 FROM money_refund_requests WHERE user_id=? LIMIT 1').get(id,id,id);
 return {pending:!!pending || !!account?.balance || !!account?.reserved,history:!!history};
}
export function recordErasure(file,user) {
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const fd=fs.openSync(file,'a',0o600);
 try {fs.writeSync(fd,JSON.stringify({id:user.id,identity:fingerprint(user),at:new Date().toISOString()})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
export function eraseAccount(db,user,{preserveFinancial=false}={}) {
 const id=user.id;
 ensureErasureTables(db);
 db.exec('BEGIN IMMEDIATE');
 try {
  for(const row of db.prepare('SELECT file FROM proofs WHERE user_id=?').all(id)) db.prepare('INSERT OR IGNORE INTO account_media_cleanup VALUES (?)').run(row.file);
  db.prepare('DELETE FROM friendships WHERE user_id=? OR friend_id=?').run(id,id);
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='content_reports'").get())db.prepare('DELETE FROM content_reports WHERE reporter_id=? OR target_id=?').run(id,id);
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='user_blocks'").get())db.prepare('DELETE FROM user_blocks WHERE user_id=? OR target_id=?').run(id,id);
  db.prepare('UPDATE habits SET buddy=? WHERE buddy=?').run('',user.login);
  for(const row of db.prepare('SELECT user_id,data FROM user_state WHERE user_id<>?').all(id)) {
   let state; try{state=JSON.parse(row.data);}catch{continue;}
   if(Array.isArray(state.friends)){state.friends=state.friends.filter(friend=>friend?.login!==user.login && friend!==user.login);db.prepare('UPDATE user_state SET data=? WHERE user_id=?').run(JSON.stringify(state),row.user_id);}
  }
  db.prepare('DELETE FROM habit_invites WHERE owner_id=? OR habit_id IN (SELECT id FROM habits WHERE user_id=?)').run(id,id);
  db.prepare('DELETE FROM completions WHERE habit_id IN (SELECT id FROM habits WHERE user_id=?)').run(id);
  const tables=['blocking_receipts','blocking_devices','moderation_appeals','moderation_notices','moderation_bans','sessions','social_identities','oauth_flows','password_resets','legal_acceptances','money_settlement_cursors','sandbox_ledger','sandbox_payment_intents','sandbox_accounts','proofs','proof_skips','promise_day_skips','promise_full_day_skips','promise_skip_purchases','trusted_bit_awards','trusted_bits','charges','transactions','wallets','user_state','habits','email_codes','account_delete_limits','account_deletion_requests'];
  if(!preserveFinancial)tables.unshift('money_penalties','money_terms','money_accounts');
  for(const table of tables){
   if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) && db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='user_id'))db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(id);
  }
  if(preserveFinancial){
   const anonymous='deleted_'+randomBytes(16).toString('hex');
   db.prepare('UPDATE users SET login=?,email=?,pass_hash=?,pass_salt=?,email_verified=0 WHERE id=?').run(anonymous,anonymous+'@invalid.invalid',randomBytes(64).toString('hex'),randomBytes(16).toString('hex'),id);
   db.prepare('UPDATE money_payment_intents SET confirmation_url=NULL WHERE user_id=?').run(id);
  }else db.prepare('DELETE FROM users WHERE id=?').run(id);
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
export function replayErasures(db,file) {
 if(!fs.existsSync(file))throw Error('Deletion journal missing; restoration cannot safely continue');
 let applied=0;
 for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){
  const entry=JSON.parse(line);
  if(!Number.isInteger(entry.id)||!/^[a-f0-9]{64}$/.test(entry.identity))throw Error('Invalid deletion journal');
  const user=db.prepare('SELECT * FROM users WHERE id=?').get(entry.id);
  if(user && fingerprint(user)===entry.identity){eraseAccount(db,user,{preserveFinancial:financialState(db,user.id).history});applied++;}
 }
 return applied;
}
export function cleanupErasedMedia(db,root) {
 ensureErasureTables(db);
 for(const {file} of db.prepare('SELECT file FROM account_media_cleanup').all()){
  if(path.basename(file)!==file)throw Error('Unsafe deleted media path');
  try{fs.rmSync(path.join(root,file),{force:true});db.prepare('DELETE FROM account_media_cleanup WHERE file=?').run(file);}catch{console.error('[account] media cleanup pending');}
 }
}
