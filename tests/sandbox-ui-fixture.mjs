// Local visual fixture. Never points at a real YooKassa credential.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'disbit-sandbox-ui-'));
process.env.DB_PATH = join(dir, 'db.sqlite');
process.env.APP_ENV = 'test';
process.env.PAYMENTS_PROVIDER = 'disabled';
process.env.YOOKASSA_TEST_ENABLED = '1';
process.env.YOOKASSA_TEST_SHOP_ID = '1234567';
process.env.YOOKASSA_TEST_SECRET_KEY = `test_${randomBytes(24).toString('hex')}`;
process.env.PUBLIC_URL = 'https://disbit.ru';
process.env.PORT = '3399';
const db = new DatabaseSync(process.env.DB_PATH);
db.exec(readFileSync(new URL('../backend/db/schema.sql', import.meta.url), 'utf8'));
db.prepare('INSERT INTO users(id,login,email,pass_hash,pass_salt) VALUES (?,?,?,?,?)')
  .run(1, 'tester', 'tester@example.invalid', 'fixture', 'fixture');
db.prepare('INSERT INTO users(id,login,email,pass_hash,pass_salt) VALUES (?,?,?,?,?)')
  .run(2, 'other', 'other@example.invalid', 'fixture', 'fixture');
db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)')
  .run('a'.repeat(64), 1, Date.now() + 3600000);
db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)')
  .run('b'.repeat(64), 2, Date.now() + 3600000);
if (process.env.DISBIT_HISTORY_FIXTURE === '1') {
  const intent=db.prepare('INSERT INTO sandbox_payment_intents(id,user_id,request_id,amount,idempotency_key,provider_payment_id,status,created_at) VALUES (?,?,?,?,?,?,?,?)');
  const ledger=db.prepare('INSERT INTO sandbox_ledger(user_id,source_key,amount,balance_after,provider_payment_id) VALUES (?,?,?,?,?)');
  db.prepare('INSERT INTO sandbox_accounts(user_id,balance) VALUES (?,?)').run(1,35*5000);
  for(let i=0;i<35;i++) {
    const id=randomUUID(), providerId=`fixture-payment-${i}`;
    intent.run(id,1,randomUUID(),5000,`fixture-${id}`,providerId,'succeeded',`2026-10-26 20:${String(i).padStart(2,'0')}:00`);
    ledger.run(1,`sandbox-topup:${id}`,5000,(i+1)*5000,providerId);
  }
  const canceledId=randomUUID();
  intent.run(canceledId,1,randomUUID(),5000,`fixture-${canceledId}`,'fixture-canceled','canceled','2026-10-26 21:00:00');
}
db.close();
await import('../backend/server.js');
