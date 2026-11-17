/* ============================================================
   Кошелёк: баланс, пополнение депозита, история, вебхук провайдера.
   Сам штраф списывается не тут, а при записи пропуска (routes/charges.js).
   ============================================================ */

import { Router } from 'express';
import express from 'express';
import crypto from 'node:crypto';
import { getBalance, credit, history, chargedTotal } from '../lib/wallet.js';
import { createTopup, paymentsInfo } from '../lib/payments.js';
import { db } from '../db/db.js';
import { createYooKassaClient } from '../lib/yookassa-client.js';
import { topupProblem, topupQuote, TOPUP_MIN, TOPUP_MAX, BALANCE_MAX } from '../lib/money-limits.js';
import { sandboxConfig, sandboxAllowed, sandboxSnapshot, sandboxHistory, createSandboxService } from '../lib/sandbox-deposit.js';

const router = Router();

const testShop = sandboxConfig();
const sandbox = testShop.enabled
  ? createSandboxService(db,createYooKassaClient({shopId:testShop.shopId,secretKey:testShop.secretKey}),testShop.shopId)
  : null;
const testAllowed = userId => sandboxAllowed(db,userId,testShop);

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
    limits: { topupMin: TOPUP_MIN, topupMax: TOPUP_MAX, balanceMax: BALANCE_MAX, feePercent: 3.8 },
    history: history(req.userId, 30),
    sandbox: testAllowed(req.userId) ? sandboxSnapshot(db,req.userId) : null
  });
});

// The profile gets a short preview; the separate history screen can page through every operation.
router.get('/history', authRequired, (req, res) => {
  const offset = Number(req.query.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000)
    return res.status(400).json({ error: 'Неверная страница истории' });
  const limit = 30;
  const sandboxMode = testAllowed(req.userId);
  const rows = sandboxMode
    ? sandboxHistory(db,req.userId,limit + 1,offset)
    : history(req.userId,limit + 1,offset);
  res.json({ history: rows.slice(0,limit), hasMore: rows.length > limit, offset: offset + Math.min(rows.length,limit), sandbox: sandboxMode });
});

// Test-shop flows never write to wallets/transactions or the real money_* tables.
router.post('/sandbox/topup', authRequired, express.json(), async (req, res) => {
  if (!testAllowed(req.userId)) return res.status(404).json({ error: 'Тестовый депозит недоступен' });
  const amount = req.body?.amount;
  const requestId = req.body?.requestId;
  if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId))
    return res.status(400).json({ error: 'Нужен ID запроса' });
  const snapshot = sandboxSnapshot(db,req.userId);
  const pending = db.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM sandbox_payment_intents WHERE user_id=? AND status IN ('created','pending') AND request_id<>?").get(req.userId,requestId).n;
  const problem = topupProblem(amount, snapshot?.balance || 0, pending);
  if (problem) return res.status(400).json(problem);
  try {
    const result = await sandbox.start(req.userId,amount,requestId,new URL('/?sandbox_paid=1',process.env.PUBLIC_URL).href);
    res.json({ ok:true, sandbox:true, ...result });
  } catch (error) {
    console.error('[sandbox] create failed:', error.message);
    res.status(502).json({ error: 'Не удалось создать тестовый платёж. Повтори с тем же запросом.' });
  }
});

router.get('/sandbox/status/:id', authRequired, async (req, res) => {
  if (!testAllowed(req.userId)) return res.status(404).json({ error: 'Тестовый депозит недоступен' });
  try {
    const result = await sandbox.status(req.userId,req.params.id);
    if (!result) return res.status(404).json({ error: 'Тестовый платёж не найден' });
    res.json({ sandbox:true, ...result });
  } catch (error) {
    console.error('[sandbox] status failed:', error.message);
    res.status(502).json({ error: 'Не удалось проверить тестовый платёж' });
  }
});

router.post('/sandbox/webhook', express.json(), async (req, res) => {
  if (!sandbox) return res.status(404).json({ error: 'Тестовый магазин выключен' });
  try { await sandbox.notification(req.body); res.json({ ok:true }); }
  catch (error) {
    console.error('[sandbox] notification failed:', error.message);
    res.status(503).json({ error: 'Тестовый платёж пока не проверен' });
  }
});

// POST /api/wallet/topup { amount } — amount в КОПЕЙКАХ
router.post('/topup', authRequired, express.json(), async (req, res) => {
  if (!paymentsInfo().available) return res.status(503).json({ error: 'Пополнение пока недоступно', code: 'PAYMENTS_DISABLED' });
  const amount = req.body?.amount;
  const problem = topupProblem(amount, getBalance(req.userId).balance);
  if (problem) return res.status(400).json(problem);
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
      return res.json({ ok: true, instant: true, balance: r.balance, simulated: true, quote: topupQuote(amount) });
    }
    res.json({ ok: true, url: t.url, providerId: t.providerId, simulated: info.simulated, quote: topupQuote(amount) });
  } catch (e) {
    console.error('[wallet] topup:', e.message);
    res.status(502).json({ error: 'Не удалось создать платёж' });
  }
});

// The old unverified webhook is closed for good. Real top-ups are credited only
// from an authenticated provider GET (lib/money-service.js).
router.post('/webhook', (req, res) => res.status(503).json({ error: 'Payments disabled' }));

export default router;
