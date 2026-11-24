// Локальный сервер для браузерного сценария Telegram: обычная фикстура + поддельный Bot API.
// Токен и секрет — синтетические, только для тестов.
import { startFakeTelegram } from './fake-telegram.mjs';
const fake = await startFakeTelegram();
Object.assign(process.env, {
  TELEGRAM_BOT_TOKEN: '123456789:TEST-token-for-unit-tests-only', TELEGRAM_WEBHOOK_SECRET: 'webhook-secret-for-tests-0123456789',
  TELEGRAM_BOT_USERNAME: 'disbit_test_bot', TELEGRAM_API_BASE: fake.url
});
await import('./fixture-server.mjs');
