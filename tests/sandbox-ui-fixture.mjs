// Local visual fixture. Never points at a real YooKassa credential.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'disbit-sandbox-ui-'));
process.env.DB_PATH = join(dir, 'db.sqlite');
process.env.APP_ENV = 'test';
process.env.PAYMENTS_PROVIDER = 'disabled';
process.env.YOOKASSA_TEST_ENABLED = '1';
process.env.YOOKASSA_TEST_SHOP_ID = '1234567';
process.env.YOOKASSA_TEST_SECRET_KEY = `test_${randomBytes(24).toString('hex')}`;
process.env.YOOKASSA_TEST_ALLOWED_LOGINS = 'tester';
process.env.PUBLIC_URL = 'https://disbit.ru';
process.env.PORT = '3399';
const db = new DatabaseSync(process.env.DB_PATH);
db.exec(readFileSync(new URL('../backend/db/schema.sql', import.meta.url), 'utf8'));
db.prepare('INSERT INTO users(id,login,email,pass_hash,pass_salt) VALUES (1,?,?,?,?)')
  .run('tester', 'tester@example.invalid', 'fixture', 'fixture');
db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,1,?)')
  .run('a'.repeat(64), Date.now() + 3600000);
db.close();
await import('../backend/server.js');
