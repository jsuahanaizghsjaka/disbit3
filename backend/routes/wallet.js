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
import { runtime } from '../lib/runtime.js';
import { createMoneyService } from '../lib/money-service.js';
import { moneyBalance } from '../lib/money-core.js';
import { acceptMoneyTerms, settleClosedMoneyDays } from '../lib/money-settlement.js';
import { moneySnapshot, moneyHistory, legalState, agreementHash, refundHold } from '../lib/money-live.js';
import { LEGAL_VERSIONS, recordConsent } from '../lib/legal.js';
import { accountDay } from '../proof-policy.js';
import { requestLimit } from '../lib/request-limits.js';

const router = Router();

/* Live deposit through the Disbit YooKassa shop (PAYMENTS_PROVIDER=yookassa).
   It uses only the money_* ledger; the historical manual wallet stays local. */
export const moneyService = runtime.provider === 'yookassa'
  ? createMoneyService(db, createYooKassaClient({ shopId: process.env.YOOKASSA_SHOP_ID, secretKey: process.env.YOOKASSA_SECRET_KEY }))
  : null;
export const moneyReturnUrl = moneyService ? new URL('/?paid=1', process.env.PUBLIC_URL).href : null;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGAL_OUTDATED = { code: 'legal_outdated', error: 'Прими действующую редакцию пользовательского соглашения и согласия на обработку данных' };

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
// The app returns from the payment page by itself; one fresh provider check of
// the latest open top-up per account, at most every 10 seconds.
const lastPendingCheck = new Map();
async function refreshPending(userId) {
  const open = db.prepare(`SELECT id FROM money_payment_intents WHERE user_id=? AND status='pending'
    AND provider_payment_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`).get(userId);
  if (!open || Date.now() - (lastPendingCheck.get(userId) || 0) < 10000) return;
  lastPendingCheck.set(userId, Date.now());
  // The wallet answer waits at most 4 s; a slower check finishes in the background.
  const check = moneyService.resumePayment(open.id, moneyReturnUrl)
    .catch(error => console.error('[money] pending check failed:', error.message));
  await Promise.race([check, new Promise(resolve => setTimeout(resolve, 4000).unref())]);
}

router.get('/', authRequired, async (req, res) => {
  if (moneyService) {
    await refreshPending(req.userId);
    return res.json(moneySnapshot(db, req.userId, paymentsInfo()));
  }
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
  if (moneyService) {
    const rows = moneyHistory(db, req.userId, limit + 1, offset);
    return res.json({ history: rows.slice(0,limit), hasMore: rows.length > limit, offset: offset + Math.min(rows.length,limit), sandbox: false });
  }
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

function intentReply(intent, extra = {}) {
  return { ok: true, id: intent.id, status: intent.status, providerId: intent.provider_payment_id || null,
    url: intent.status === 'pending' && /^https:\/\//.test(intent.confirmation_url || '') ? intent.confirmation_url : null,
    quote: topupQuote(intent.amount), ...extra };
}
async function resumeOwnPayment(userId, id) {
  const intent = db.prepare('SELECT * FROM money_payment_intents WHERE id=? AND user_id=?').get(id, userId);
  if (!intent) return null;
  await moneyService.resumePayment(intent.id, moneyReturnUrl);
  return intentReply(db.prepare('SELECT * FROM money_payment_intents WHERE id=?').get(intent.id),
    { balance: moneyBalance(db, userId).balance });
}

// POST /api/wallet/topup { amount, requestId } — amount в КОПЕЙКАХ.
// requestId is the intent ID: repeating the request after a lost answer
// resumes the same payment and never creates a second one.
async function liveTopup(req, res) {
  const { amount, requestId } = req.body || {};
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) return res.status(400).json({ error: 'Нужен ID запроса' });
  try {
    const own = db.prepare('SELECT user_id FROM money_payment_intents WHERE id=?').get(requestId);
    if (own && own.user_id !== req.userId) return res.status(404).json({ error: 'Платёж не найден' });
    if (own) return res.json(await resumeOwnPayment(req.userId, requestId));
    if (!legalState(db, req.userId).current) return res.status(409).json(LEGAL_OUTDATED);
    // An unpaid top-up of the same amount from the last 10 minutes is continued
    // (a second tap or a return from the payment page); another amount starts anew.
    const open = db.prepare(`SELECT id FROM money_payment_intents WHERE user_id=? AND amount=? AND status IN ('created','pending')
      AND created_at > datetime('now','-10 minutes') ORDER BY created_at DESC LIMIT 1`).get(req.userId, amount);
    if (open) {
      const reply = await resumeOwnPayment(req.userId, open.id);
      if (reply.status !== 'canceled') return res.json(reply);
    }
    const problem = topupProblem(amount, moneyBalance(db, req.userId).balance);
    if (problem) return res.status(400).json(problem);
    await moneyService.startPayment(req.userId, amount, moneyReturnUrl, requestId);
    res.json(intentReply(db.prepare('SELECT * FROM money_payment_intents WHERE id=?').get(requestId)));
  } catch (error) {
    if (error.code) return res.status(400).json({ code: error.code, error: error.message });
    if (/Manual reconciliation/.test(error.message)) return res.status(409).json({ error: 'Платёж проверяется вручную. Напиши в поддержку: disbitx1@gmail.com' });
    console.error('[money] topup failed:', error.message);
    res.status(502).json({ error: 'Не удалось связаться с ЮKassa. Повтори — второй платёж не создастся.' });
  }
}

router.get('/topup/:id', authRequired, async (req, res) => {
  if (!moneyService) return res.status(404).json({ error: 'Платёж не найден' });
  try {
    const reply = await resumeOwnPayment(req.userId, String(req.params.id));
    if (!reply) return res.status(404).json({ error: 'Платёж не найден' });
    res.json(reply);
  } catch (error) {
    console.error('[money] status failed:', error.message);
    res.status(502).json({ error: 'Не удалось проверить платёж. Повтори позже.' });
  }
});

// POST /api/wallet/refund { amount, requestId } — возврат свободного остатка
// на исходные способы оплаты (Приложение № 3 к соглашению).
router.post('/refund', authRequired, requestLimit('money-refund', 10, 60*60000, req => req.userId), express.json(), async (req, res) => {
  if (!moneyService) return res.status(503).json({ error: 'Возврат пока недоступен', code: 'PAYMENTS_DISABLED' });
  const { amount, requestId } = req.body || {};
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) return res.status(400).json({ error: 'Нужен ID запроса' });
  const known = db.prepare('SELECT user_id,status FROM money_refund_requests WHERE id=?').get(requestId);
  if (known) return known.user_id === req.userId ? res.json({ ok: true, id: requestId, status: known.status, duplicate: true })
    : res.status(404).json({ error: 'Возврат не найден' });
  if (!Number.isSafeInteger(amount) || amount < 100) return res.status(400).json({ error: 'Сумма возврата — от 1 ₽' });
  try { settleClosedMoneyDays(db); } catch (error) { console.error('[money] settle before refund:', error.message); }
  const { available } = moneyBalance(db, req.userId);
  const free = Math.max(0, available - refundHold(db, req.userId, accountDay(req)));
  if (amount > free) return res.status(400).json({ code: 'refund_limit', left: free,
    error: free < available ? `Можно вернуть до ${Math.floor(free/100)} ₽: часть ждёт решения по пруфу` : `Можно вернуть до ${Math.floor(free/100)} ₽` });
  try {
    const result = await moneyService.startRefund(req.userId, amount, requestId);
    const status = db.prepare('SELECT status FROM money_refund_requests WHERE id=?').get(result.id).status;
    res.json({ ok: true, id: result.id, status, balance: moneyBalance(db, req.userId) });
  } catch (error) {
    console.error('[money] refund failed:', error.message);
    res.status(400).json({ error: /Insufficient|No matching/.test(error.message) ? 'Недостаточно свободного остатка' : 'Не удалось оформить возврат' });
  }
});

// POST /api/wallet/terms { habitId } — отдельное согласие на Денежное условие
// по конкретному обещанию (раздел 6 соглашения). The new edition may be
// accepted in the same request (acceptTerms + acceptPersonalData).
router.post('/terms', authRequired, express.json(), (req, res) => {
  if (!moneyService) return res.status(503).json({ error: 'Денежные условия пока недоступны', code: 'PAYMENTS_DISABLED' });
  if (req.body?.accept !== true) return res.status(400).json({ error: 'Нужно явное согласие с денежным условием' });
  if (!legalState(db, req.userId).current) {
    if (req.body?.acceptTerms !== true || req.body?.acceptPersonalData !== true) return res.status(409).json(LEGAL_OUTDATED);
    recordConsent(db, req.userId, 'app');
  }
  try {
    const result = acceptMoneyTerms(db, { userId: req.userId, habitId: String(req.body?.habitId || ''),
      agreementVersion: LEGAL_VERSIONS.terms, agreementHash: agreementHash() });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(422).json({ error: 'Денежное условие доступно для обещания со штрафом деньгами создателям и суммой от 10 ₽' });
  }
});

router.post('/topup', authRequired, express.json(), async (req, res) => {
  if (moneyService) return liveTopup(req, res);
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
// YooKassa HTTP notifications. The body only names an object: the decision is
// made from an authenticated GET to the shop (lib/money-service.js).
router.post('/webhook', requestLimit('money-webhook', 600, 60000), express.json(), async (req, res) => {
  if (!moneyService) return res.status(503).json({ error: 'Payments disabled' });
  try { await moneyService.receiveNotification(req.body); res.json({ ok: true }); }
  catch (error) {
    console.error('[money] notification failed:', error.message);
    res.status(503).json({ error: 'Not verified yet' }); // YooKassa retries
  }
});

export default router;
