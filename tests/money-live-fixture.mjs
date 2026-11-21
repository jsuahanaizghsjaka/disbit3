// Local fixture for the live deposit UI. YooKassa is replaced by
// tests/fake-yookassa.mjs; a control port lets a scenario "pay" in the bank.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directory = mkdtempSync(path.join(tmpdir(), 'disbit-live-ui-'));
Object.assign(process.env, {
  DB_PATH: path.join(directory, 'test.db'), PROOFS_DIR: path.join(directory, 'proofs'),
  PORT: process.env.PORT || '3421', APP_ENV: 'development', NODE_ENV: 'test',
  PAYMENTS_PROVIDER: 'yookassa', YOOKASSA_SHOP_ID: '1527679', YOOKASSA_SECRET_KEY: 'test_' + 'f'.repeat(40),
  PUBLIC_URL: 'https://disbit.test/', ADMIN_KEY: 'live-ui-fixture-admin-key-1234567890',
  FAKE_YOOKASSA_STATE: path.join(directory, 'yookassa.json')
});
await import('./fake-yookassa.mjs');
const { db } = await import('../backend/db/db.js');
const { LEGAL_VERSIONS } = await import('../backend/lib/legal.js');
const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
for (const [id, login, current] of [[1, 'payer', true], [2, 'old_edition', false]]) {
  db.prepare('INSERT INTO users (id,login,email,pass_hash,pass_salt,email_verified) VALUES (?,?,?,?,?,1)')
    .run(id, login, `${login}@example.invalid`, 'no-login', 'no-login');
  db.prepare('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)').run(String(id).repeat(64), id, Date.now() + 3600000);
  for (const [document, version] of Object.entries(LEGAL_VERSIONS))
    db.prepare("INSERT INTO legal_acceptances(user_id,document,version,source,accepted_at) VALUES (?,?,?,'email',?)")
      .run(id, document, current ? version : '2026-11-01', Date.now());
}
db.prepare(`INSERT INTO habits(id,user_id,name,icon,color,schedule,stake_mode,stake_amount,stake_recipient,created_day)
  VALUES ('run',1,'Пробежка','svg:i-h-book','#22C55E','[0,1,2,3,4,5,6]','money',100,'creators',?)`).run(yesterday);
await import('../backend/server.js');

// POST /pay — every open payment succeeds; POST /cancel — every open payment is canceled.
const control = Number(process.env.PORT) + 1;
createServer((req, res) => {
  const state = JSON.parse(readFileSync(process.env.FAKE_YOOKASSA_STATE, 'utf8'));
  for (const payment of Object.values(state.payments)) if (payment.status === 'pending')
    Object.assign(payment, req.url === '/pay' ? { status: 'succeeded', paid: true } : { status: 'canceled' });
  writeFileSync(process.env.FAKE_YOOKASSA_STATE, JSON.stringify(state));
  res.end('ok');
}).listen(control, '127.0.0.1');
console.log('LIVE MONEY FIXTURE READY');
