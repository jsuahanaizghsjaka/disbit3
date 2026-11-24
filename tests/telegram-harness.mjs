// Обвязка для тестов Telegram: временная база, поддельный Bot API и Express только с нужными маршрутами.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { startFakeTelegram } from './fake-telegram.mjs';

export const BOT_TOKEN = '123456789:TEST-token-for-unit-tests-only';
export const WEBHOOK_SECRET = 'webhook-secret-for-tests-0123456789';

// Независимая от кода сервера подпись initData (по документации Telegram).
export function signInitData(user, { token = BOT_TOKEN, authDate = Math.floor(Date.now() / 1000), startParam, extra = {} } = {}) {
  const fields = { auth_date: String(authDate), query_id: 'AAH-test', user: JSON.stringify(user), ...(startParam ? { start_param: startParam } : {}), ...extra };
  const check = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

export async function startHarness() {
  const directory = mkdtempSync(path.join(tmpdir(), 'disbit-tg-'));
  const fake = await startFakeTelegram();
  Object.assign(process.env, {
    DB_PATH: path.join(directory, 'test.db'), PROOFS_DIR: path.join(directory, 'proofs'),
    DELETION_JOURNAL_PATH: path.join(directory, 'deletions.jsonl'),
    PAYMENTS_PROVIDER: 'manual', ADMIN_KEY: 'harness-only-admin-key-0123456789abcdef',
    TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
    TELEGRAM_BOT_USERNAME: 'disbit_test_bot', TELEGRAM_API_BASE: fake.url, PUBLIC_URL: 'https://disbit.ru'
  });
  const { default: express } = await import('../backend/node_modules/express/index.js');
  const { db } = await import('../backend/db/db.js');
  const { authMiddleware } = await import('../backend/routes/auth.js');
  const { telegramAuthRouter, telegramRouter } = await import('../backend/routes/telegram.js');
  const { default: accountRouter } = await import('../backend/routes/account.js');
  const { default: habitsRouter } = await import('../backend/routes/habits.js');
  const { default: friendsRouter } = await import('../backend/routes/friends.js');
  const { default: authRouter } = await import('../backend/routes/auth.js');
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/auth/telegram', telegramAuthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/telegram', telegramRouter);
  app.use('/api/account', accountRouter);
  app.use('/api/habits', habitsRouter);
  app.use('/api/friends', friendsRouter);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, route, body, token) => fetch(base + route, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const webhook = (update, secret = WEBHOOK_SECRET) => fetch(base + '/api/telegram/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify(update)
  });
  return {
    db, fake, call, webhook, base,
    bot: await import('../backend/lib/telegram-bot.js'),
    tg: await import('../backend/lib/telegram.js'),
    habitsLib: await import('../backend/lib/telegram-habits.js'),
    authLib: await import('../backend/lib/telegram-auth.js'),
    secrets: await import('../backend/lib/auth-secrets.js'),
    close: async () => { server.close(); await fake.close(); db.close(); }
  };
}
