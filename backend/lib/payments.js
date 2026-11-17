/* ============================================================
   Платёжные провайдеры — общий интерфейс, чтобы приложение не зависело
   от конкретного банка. Подключить ЮKassa = дописать один адаптер и
   выставить переменные окружения; остальной код не меняется.

   Адаптер обязан уметь:
     createTopup(userId, amountKop, opts) → { url, providerId }

   manual доступен только локально. Размещённые среды используют disabled.
   Настоящие платежи ЮKassa идут через lib/money-core.js и lib/money-service.js.
   ============================================================ */

import { runtime } from './runtime.js';
const PROVIDER = runtime.provider;

export function paymentsInfo() {
  return {
    provider: PROVIDER,
    live: false,
    available: PROVIDER === 'manual',
    currency: process.env.PAYMENTS_CURRENCY || 'RUB',
    // подсказка фронту: в ручном режиме деньги ненастоящие
    simulated: PROVIDER === 'manual'
  };
}

/* ---------- Тестовый режим ---------- */
function manualCreateTopup(userId, amountKop, opts) {
  // денег не берём: сразу отдаём «оплачено», чтобы можно было щупать логику
  return { url: null, providerId: 'manual_' + opts.idempotenceKey, instant: true };
}

/* ---------- Публичный интерфейс ---------- */
export async function createTopup(userId, amountKop, opts) {
  if (PROVIDER !== 'manual') throw new Error('Payments are disabled pending release approval');
  return manualCreateTopup(userId, amountKop, opts);
}
