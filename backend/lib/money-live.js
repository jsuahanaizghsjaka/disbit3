// Live deposit through the Disbit YooKassa shop: snapshots, history and the
// checks around top-up, refund and accepting a money condition for a promise.
// Every balance change itself lives in money-core.js.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { moneyBalance } from './money-core.js';
import { LEGAL_VERSIONS } from './legal.js';
import { TOPUP_MIN, TOPUP_MAX, BALANCE_MAX } from './money-limits.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TERMS_FILE = path.join(__dirname, '..', '..', 'frontend', 'terms.html');

// The hash binds each money condition to the exact published offer text.
// Line endings are normalised so a Windows checkout gives the same digest.
let termsHash = null;
export function agreementHash() {
  if (!termsHash) termsHash = createHash('sha256')
    .update(readFileSync(TERMS_FILE, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  return termsHash;
}

// The account must have accepted the current edition of both documents.
export function legalState(db, userId) {
  const accepted = Object.fromEntries(Object.keys(LEGAL_VERSIONS).map(document => [document,
    db.prepare('SELECT 1 FROM legal_acceptances WHERE user_id=? AND document=? AND version=? LIMIT 1')
      .get(userId, document, LEGAL_VERSIONS[document])]));
  return { current: Object.values(accepted).every(Boolean), version: LEGAL_VERSIONS.terms };
}

const iso = value => value ? value.replace(' ', 'T') + 'Z' : null;

// One list for the app: top-ups, refunds, penalties and corrections, newest first.
export function moneyHistory(db, userId, limit = 30, offset = 0) {
  return db.prepare(`
    SELECT 'p-'||p.id AS id,'topup' AS type,p.amount AS amount,p.fee AS fee,p.status AS status,
      p.provider_payment_id AS provider_id,p.created_at AS created_at,l.balance_after AS balance_after,
      NULL AS name,NULL AS day
    FROM money_payment_intents p LEFT JOIN money_ledger l ON l.source_key='topup:'||p.id WHERE p.user_id=:user
    UNION ALL
    SELECT 'r-'||q.id,'refund',-q.amount,0,q.status,NULL,q.created_at,NULL,NULL,NULL
    FROM money_refund_requests q WHERE q.user_id=:user
    UNION ALL
    SELECT 'n-'||n.id,'charge',-n.amount,0,CASE n.status WHEN 'paid' THEN 'done' ELSE 'failed' END,NULL,n.created_at,
      l.balance_after,h.name,n.day
    FROM money_penalties n LEFT JOIN habits h ON h.id=n.habit_id
      LEFT JOIN money_ledger l ON l.source_key='penalty:'||n.user_id||':'||n.habit_id||':'||n.day
    WHERE n.user_id=:user
    UNION ALL
    SELECT 'c-'||l.id,'correction',l.amount,0,'done',NULL,l.created_at,l.balance_after,NULL,NULL
    FROM money_ledger l WHERE l.user_id=:user AND l.type='correction'
    ORDER BY created_at DESC,id DESC LIMIT :limit OFFSET :offset`).all({ user: userId, limit, offset })
    .map(row => ({
      id: row.id, type: row.type, amount: row.amount, status: row.status, provider: 'yookassa',
      provider_id: row.provider_id, balance_after: row.balance_after, created_at: iso(row.created_at),
      meta: row.type === 'charge' ? { name: row.name || 'Удалённое обещание', day: row.day }
        : row.type === 'topup' ? { fee: row.fee } : null
    }));
}

// Latest accepted condition per promise: what the app shows next to it.
export function moneyTerms(db, userId) {
  return db.prepare(`SELECT habit_id,amount,effective_day,accepted_at FROM money_terms t
    WHERE user_id=? AND effective_day=(SELECT MAX(effective_day) FROM money_terms WHERE user_id=t.user_id AND habit_id=t.habit_id)`)
    .all(userId).map(row => ({ habitId: row.habit_id, amount: row.amount, effectiveDay: row.effective_day, acceptedAt: iso(row.accepted_at) }));
}

export function moneySnapshot(db, userId, payments) {
  const { balance, reserved, available } = moneyBalance(db, userId);
  const charged = db.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM money_penalties WHERE user_id=? AND status='paid'").get(userId).n;
  const pending = db.prepare(`SELECT id,amount,fee,status,confirmation_url FROM money_payment_intents
    WHERE user_id=? AND status IN ('created','pending') ORDER BY created_at DESC LIMIT 1`).get(userId);
  return {
    balance, reserved, available, currency: 'RUB', charged, payments,
    limits: { topupMin: TOPUP_MIN, topupMax: TOPUP_MAX, balanceMax: BALANCE_MAX, feePercent: 3.8 },
    pending: pending ? { id: pending.id, amount: pending.amount, fee: pending.fee, status: pending.status,
      url: pending.confirmation_url && /^https:\/\//.test(pending.confirmation_url) ? pending.confirmation_url : null } : null,
    legal: legalState(db, userId),
    terms: moneyTerms(db, userId),
    history: moneyHistory(db, userId, 30),
    sandbox: null
  };
}

// A refund must not outrun a penalty that is still being decided: closed days
// with a proof waiting for the moderator keep the amount that may be held.
export function refundHold(db, userId, today) {
  return db.prepare(`SELECT COALESCE(SUM(t.amount),0) AS n
    FROM (SELECT DISTINCT user_id,habit_id,day FROM proofs WHERE user_id=? AND status='pending' AND day<?) p
    JOIN money_terms t ON t.user_id=p.user_id AND t.habit_id=p.habit_id
      AND t.effective_day=(SELECT MAX(effective_day) FROM money_terms WHERE user_id=p.user_id AND habit_id=p.habit_id AND effective_day<=p.day)
    `).get(userId, today).n;
}
