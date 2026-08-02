/* ============================================================
   Платёжные провайдеры — общий интерфейс, чтобы приложение не зависело
   от конкретного банка. Подключить ЮKassa = дописать один адаптер и
   выставить переменные окружения; остальной код не меняется.

   Адаптер обязан уметь:
     createTopup(userId, amountKop, opts) → { url, providerId }
     parseWebhook(req)                    → { providerId, amountKop, paid, userId }

   Сейчас активен 'manual' — тестовый режим без денег: зачисляет сразу.
   Он НЕ должен работать на проде: включается только PAYMENTS_MODE=manual.
   ============================================================ */

const PROVIDER = (process.env.PAYMENTS_PROVIDER || 'manual').toLowerCase();

export function paymentsInfo() {
  return {
    provider: PROVIDER,
    live: PROVIDER !== 'manual',
    currency: process.env.PAYMENTS_CURRENCY || 'RUB',
    // подсказка фронту: в ручном режиме деньги ненастоящие
    simulated: PROVIDER === 'manual'
  };
}

/* ---------- ЮKassa (заготовка: включится, когда будут ключи) ---------- */
async function yookassaCreateTopup(userId, amountKop, opts) {
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const key = process.env.YOOKASSA_SECRET_KEY;
  if (!shopId || !key) throw new Error('Нет YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY');

  const auth = Buffer.from(`${shopId}:${key}`).toString('base64');
  const r = await fetch('https://api.yookassa.ru/v3/payments', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Idempotence-Key': opts.idempotenceKey,     // защита от двойного списания
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount: { value: (amountKop / 100).toFixed(2), currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: opts.returnUrl },
      description: 'Пополнение депозита disbit',
      metadata: { userId: String(userId) }
    })
  });
  if (!r.ok) throw new Error('ЮKassa: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const p = await r.json();
  return { url: p.confirmation?.confirmation_url, providerId: p.id };
}

function yookassaParseWebhook(body) {
  const obj = body?.object;
  if (!obj) return null;
  return {
    providerId: obj.id,
    amountKop: Math.round(parseFloat(obj.amount?.value || '0') * 100),
    paid: body.event === 'payment.succeeded' && obj.status === 'succeeded',
    userId: Number(obj.metadata?.userId) || null
  };
}

/* ---------- Тестовый режим ---------- */
function manualCreateTopup(userId, amountKop, opts) {
  // денег не берём: сразу отдаём «оплачено», чтобы можно было щупать логику
  return { url: null, providerId: 'manual_' + opts.idempotenceKey, instant: true };
}

/* ---------- Публичный интерфейс ---------- */
export async function createTopup(userId, amountKop, opts) {
  if (PROVIDER === 'yookassa') return yookassaCreateTopup(userId, amountKop, opts);
  return manualCreateTopup(userId, amountKop, opts);
}

export function parseWebhook(body) {
  if (PROVIDER === 'yookassa') return yookassaParseWebhook(body);
  return null;
}
