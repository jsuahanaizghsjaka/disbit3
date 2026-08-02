/* ============================================================
   Кошелёк: баланс, пополнение депозита, история, вебхук провайдера.
   Сам штраф списывается не тут, а при записи пропуска (routes/charges.js).
   ============================================================ */

import { Router } from 'express';
import express from 'express';
import crypto from 'node:crypto';
import { getBalance, credit, history, chargedTotal } from '../lib/wallet.js';
import { createTopup, parseWebhook, paymentsInfo } from '../lib/payments.js';

const router = Router();

const MIN_TOPUP = 5000;        // 50 ₽ — меньше нет смысла: съест комиссия
const MAX_TOPUP = 5000000;     // 50 000 ₽ за раз

function authRequired(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Нужен аккаунт' });
  next();
}

// GET /api/wallet — сколько на депозите, что уже списано, история
router.get('/', authRequired, (req, res) => {
  const { balance, currency } = getBalance(req.userId);
  res.json({
    balance, currency,
    charged: chargedTotal(req.userId),
    payments: paymentsInfo(),
    history: history(req.userId, 30)
  });
});

// POST /api/wallet/topup { amount } — amount в КОПЕЙКАХ
router.post('/topup', authRequired, express.json(), async (req, res) => {
  const amount = Number(req.body?.amount);
  if (!Number.isInteger(amount) || amount < MIN_TOPUP || amount > MAX_TOPUP) {
    return res.status(400).json({
      error: `Сумма должна быть от ${MIN_TOPUP / 100} до ${MAX_TOPUP / 100} ₽`
    });
  }
  const idempotenceKey = crypto.randomUUID();
  try {
    const info = paymentsInfo();
    const t = await createTopup(req.userId, amount, {
      idempotenceKey,
      returnUrl: (process.env.PUBLIC_URL || '') + '/?paid=1'
    });

    // тестовый режим: денег не берём, зачисляем сразу — чтобы щупать логику
    if (t.instant) {
      const r = credit(req.userId, amount, {
        provider: 'manual', providerId: t.providerId, meta: { test: true }
      });
      return res.json({ ok: true, instant: true, balance: r.balance, simulated: true });
    }
    res.json({ ok: true, url: t.url, providerId: t.providerId, simulated: info.simulated });
  } catch (e) {
    console.error('[wallet] topup:', e.message);
    res.status(502).json({ error: 'Не удалось создать платёж' });
  }
});

/* POST /api/wallet/webhook — уведомление от провайдера об оплате.
   Без авторизации (приходит от банка), поэтому:
   • зачисляем только по данным из вебхука, а не из тела запроса клиента;
   • повторный вебхук не зачисляет дважды (UNIQUE provider+provider_id). */
router.post('/webhook', express.json(), (req, res) => {
  const ev = parseWebhook(req.body);
  if (!ev) return res.status(400).json({ error: 'Неизвестный формат' });
  if (!ev.paid || !ev.userId || !ev.amountKop) return res.json({ ok: true, ignored: true });

  try {
    const r = credit(ev.userId, ev.amountKop, {
      provider: paymentsInfo().provider,
      providerId: ev.providerId,
      meta: { source: 'webhook' }
    });
    res.json({ ok: true, duplicate: !!r.duplicate });
  } catch (e) {
    console.error('[wallet] webhook:', e.message);
    res.status(500).json({ error: 'Ошибка зачисления' });
  }
});

export default router;
