import { Router } from 'express';
import { db } from '../db/db.js';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {ensureErasureTables,financialState,recordErasure,eraseAccount,replayErasures,cleanupErasedMedia} from '../lib/account-erasure.js';
import '../lib/moderation.js';
import { hasConsent, recordConsent } from '../lib/legal.js';
import { legalState } from '../lib/money-live.js';
import { notifyAccountDeleted } from '../lib/telegram-bot.js';
import { isTelegramOnly, telegramConfig, linkByTelegramId } from '../lib/telegram.js';
import { verifyInitData } from '../lib/telegram-auth.js';

const proofDir = process.env.PROOFS_DIR || path.join(process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(path.dirname(fileURLToPath(import.meta.url)), '../db'), 'proofs');
db.exec(`CREATE TABLE IF NOT EXISTS account_media_cleanup (file TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS account_delete_limits (user_id INTEGER PRIMARY KEY, attempts INTEGER NOT NULL, window_start INTEGER NOT NULL);`);
ensureErasureTables(db);
const journal=process.env.DELETION_JOURNAL_PATH || path.join(path.dirname(proofDir),'deletions.jsonl');
if(!fs.existsSync(journal)) {
 if(process.env.DELETION_JOURNAL_REQUIRED==='1') throw Error('Required deletion journal missing');
 fs.writeFileSync(journal,'',{mode:0o600,flag:'wx'});
}
replayErasures(db,journal);
const cleanupMedia=()=>cleanupErasedMedia(db,proofDir);
cleanupMedia();
setInterval(cleanupMedia,60000).unref();

const router = Router();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!req.userId) return res.status(401).json({ error: 'Нужен аккаунт' });
  next();
});
// Current edition of the offer and the personal-data consent (offer, 9.2).
router.get('/legal', (req, res) => res.json(legalState(db, req.userId)));
router.post('/legal', (req, res) => {
  if (!hasConsent(req.body)) return res.status(400).json({ error: 'Отметь оба согласия' });
  if (!legalState(db, req.userId).current) recordConsent(db, req.userId, 'app');
  res.json(legalState(db, req.userId));
});
router.get('/export', (req, res) => {
  const id = req.userId;
  const account = db.prepare('SELECT id,login,email,email_verified,created_at FROM users WHERE id=?').get(id);
  if (!account) return res.status(401).json({ error: 'Нужен аккаунт' });
  const data = { app: 'disbit', format: 'server-export-v1', exportedAt: new Date().toISOString(), account };
  // Explicit allowlist excludes passwords, session tokens, OAuth flows and reset codes.
  for (const table of ['habits','user_state','charges','wallets','transactions','money_accounts','money_ledger','sandbox_accounts','sandbox_ledger','promise_day_skips','promise_full_day_skips','promise_skip_purchases','trusted_bits','trusted_bit_awards','proof_skips','legal_acceptances']) {
    data[table] = db.prepare(`SELECT * FROM ${table} WHERE user_id=?`).all(id);
  }
  data.completions = db.prepare('SELECT c.* FROM completions c JOIN habits h ON h.id=c.habit_id WHERE h.user_id=?').all(id);
  data.proofs = db.prepare('SELECT id,habit_id,habit_name,day,type,source,status,created_at FROM proofs WHERE user_id=?').all(id);
  data.friends = db.prepare('SELECT u.login FROM friendships f JOIN users u ON u.id=f.friend_id WHERE f.user_id=?').all(id);
  data.blockingDevices = db.prepare("SELECT name FROM sqlite_master WHERE name='blocking_devices'").get()
    ? db.prepare('SELECT id,platform,label,app_version,consent_version,consent_at,created_at,last_seen_at FROM blocking_devices WHERE user_id=?').all(id) : [];
  data.socialProviders = db.prepare('SELECT provider FROM social_identities WHERE user_id=?').all(id);
  res.json(data);
});
/* Полное удаление аккаунта с журналом (общий путь для удаления из профиля и слияния при привязке Telegram). */
export function eraseAccountFully(user) {
  const financial=financialState(db,user.id);
  recordErasure(journal,user);
  eraseAccount(db,user,{preserveFinancial:financial.history});
  cleanupMedia();
}
router.delete('/', (req,res) => {
  const id=req.userId;
  const user=db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!user) return res.status(401).json({error:'Нужен аккаунт'});
  if (req.body?.confirmation !== user.login) return res.status(400).json({error:'Введи свой логин для подтверждения удаления'});
  const now=Date.now();
  const limit=db.prepare('SELECT * FROM account_delete_limits WHERE user_id=?').get(id);
  if (limit && now-limit.window_start<3600000 && limit.attempts>=5) return res.status(429).json({error:'Слишком много попыток. Повтори через час.'});
  db.prepare('INSERT INTO account_delete_limits VALUES (?,1,?) ON CONFLICT(user_id) DO UPDATE SET attempts=CASE WHEN window_start<? THEN 1 ELSE attempts+1 END,window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END').run(id,now,now-3600000,now-3600000);
  if (isTelegramOnly(id)) {
    // Аккаунт создан в Telegram и пароля не имеет: личность подтверждает свежая подпись initData того же Telegram.
    let init;
    try { init=verifyInitData(req.body?.initData,telegramConfig().token,{maxAgeSec:3600}); }
    catch { return res.status(403).json({error:'Переоткройте Disbit из чата с ботом и повторите'}); }
    if (linkByTelegramId(init.user.id)?.user_id!==id) return res.status(403).json({error:'Переоткройте Disbit из чата с ботом и повторите'});
  } else {
  const password=String(req.body?.password || '');
  if (!password || password.length>256) return res.status(400).json({error:'Введи текущий пароль. Для входа через Google сначала задай пароль через восстановление.'});
  const expected=Buffer.from(user.pass_hash,'hex');
  const actual=scryptSync(password,user.pass_salt,64);
  if (expected.length!==actual.length || !timingSafeEqual(expected,actual)) return res.status(403).json({error:'Неверный пароль'});
  }
  const financial=financialState(db,id);
  if (financial.pending) {
    db.prepare('INSERT OR IGNORE INTO account_deletion_requests(user_id) VALUES (?)').run(id);
    return res.status(409).json({error:'Запрос на удаление сохранён. Сначала необходимо завершить платежи и возврат остатка. Поддержка: disbitx1@gmail.com.',deletionRequested:true});
  }
  // Persist intent before changing the DB; a crash cannot resurrect this account.
  const telegram=db.prepare('SELECT chat_id,can_write,blocked_at FROM telegram_links WHERE user_id=?').get(id);
  recordErasure(journal,user);
  eraseAccount(db,user,{preserveFinancial:financial.history});
  cleanupMedia();
  if(telegram&&telegram.can_write&&!telegram.blocked_at)notifyAccountDeleted(telegram.chat_id).catch(()=>{});
  res.json({ok:true});
});
export default router;
