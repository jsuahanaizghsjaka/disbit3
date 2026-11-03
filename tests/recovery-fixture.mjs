// Isolated process only: no real mail or user database. IPC carries synthetic
// test messages, never stdout/stderr or a hosted application endpoint.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
process.env.DB_PATH ||= path.join(mkdtempSync(path.join(tmpdir(), 'disbit-recovery-')), 'test.db');
process.env.PROOFS_DIR ||= path.join(path.dirname(process.env.DB_PATH), 'proofs');
Object.assign(process.env, { APP_ENV: 'development', NODE_ENV: 'test', PAYMENTS_PROVIDER: 'disabled',
  PASSWORD_RESET_ENABLED: '1', MAIL_PROVIDER: 'timeweb', MAIL_FROM: 'noreply@disbit.ru',
  TIMEWEB_SMTP_USER: 'noreply@disbit.ru', TIMEWEB_SMTP_PASSWORD: 'synthetic-secret' });
process.env.PORT ||= '3461';
const { db } = await import('../backend/db/db.js');
for (const [id, login, verified] of [[1,'recovery_one',1],[2,'recovery_two',1],[3,'unverified',0]]) {
  const salt = randomBytes(16).toString('hex');
  const created = db.prepare('INSERT OR IGNORE INTO users(id,login,email,pass_hash,pass_salt,email_verified) VALUES(?,?,?,?,?,?)')
    .run(id, login, login + '@example.org', scryptSync('Old-test-pass-42', salt, 64).toString('hex'), salt, verified);
  if (created.changes) db.prepare('INSERT OR IGNORE INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(String(id).repeat(64),id,Date.now()+3600000);
}
const nodemailer = (await import('../backend/node_modules/nodemailer/dist/esm/nodemailer.js')).default;
let fail = false;
process.on('message', message => { if (message.type === 'fail') { fail = message.value; process.send?.({type:'configured'}); } });
nodemailer.createTransport = () => ({
  async sendMail(mail) {
    process.send?.({type:'mail', mail});
    if (process.env.RECOVERY_TEST_OUTBOX) writeFileSync(process.env.RECOVERY_TEST_OUTBOX, JSON.stringify(mail), {mode:0o600});
    if (fail) throw Error('synthetic-secret');
    return {accepted:[mail.to]};
  }, close() {}
});
await import('../backend/server.js');
