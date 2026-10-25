// Local-only fixture. Never loads a project/production database or sends email.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const directory = mkdtempSync(path.join(tmpdir(), 'disbit-beta-'));
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.PROOFS_DIR = path.join(directory, 'proofs');
process.env.PORT ||= '3337';
process.env.PAYMENTS_PROVIDER = 'manual'; // Never create a real payment in browser tests.
const { db } = await import('../backend/db/db.js');
const today = new Date().toLocaleDateString('en-CA');
const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
for (const [id, login] of [[1, 'beta_tester'], [2, 'beta_friend'], [3, 'skip_buyer']]) {
  db.prepare('INSERT INTO users (id, login, email, pass_hash, pass_salt, email_verified) VALUES (?, ?, ?, ?, ?, 1)')
    .run(id, login, `${login}@example.invalid`, 'no-login', 'no-login');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(String(id).repeat(64), id, Date.now() + 3600000);
}
db.prepare('INSERT INTO trusted_bits(user_id,balance) VALUES (3,60)').run();
for (const [id, name, color, type, target, mode] of [
  ['beta-check', 'Читать каждый день', '#EF4444', 'check', 1, 'money'],
  ['beta-count', 'Выпить воду', '#22C55E', 'count', 2, 'money'],
  ['beta-lock', 'Старое обещание с блокировкой', '#A78BFA', 'check', 1, 'lock']
]) {
  db.prepare('INSERT INTO habits (id,user_id,name,icon,color,goal_type,goal_target,stake_mode,created_day) VALUES (?,1,?,?,?,?,?,?,?)')
    .run(id, name, 'svg:i-h-book', color, type, target, mode, yesterday);
  db.prepare('INSERT INTO completions (habit_id,day,count,done) VALUES (?,?,?,1)').run(id, yesterday, target);
}
db.prepare(`INSERT INTO habits(id,user_id,name,schedule,stake_mode,stake_amount,stake_recipient,created_day)
  VALUES ('beta-accepted-money',1,'Accepted terms','[0,1,2,3,4,5,6]','money',20,'creators',?)`).run(yesterday);
db.prepare(`INSERT INTO money_terms(id,user_id,habit_id,effective_day,schedule,week_target,goal_type,goal_target,amount,recipient,agreement_version,agreement_hash)
  VALUES ('terms-fixture',1,'beta-accepted-money',?,'[0,1,2,3,4,5,6]',0,'check',1,2000,'creators','fixture',?)`)
  .run(today,'a'.repeat(64));
db.prepare('INSERT INTO user_state (user_id,data,updated_at) VALUES (2,?,?)').run(JSON.stringify({
  profile: { name: 'Александра Длинное Имя Для Проверки', emoji: '🌿', color: '#22C55E' },
  card: { streak: 12, weekPct: 80 }
}), String(Date.now()));
await import('../backend/server.js');
console.log('LOCAL FIXTURE READY');
