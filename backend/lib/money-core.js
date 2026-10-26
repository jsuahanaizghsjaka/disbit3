import { randomUUID } from 'node:crypto';

// All amounts are integer kopecks. These tables never read the old manual wallet.
function positive(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw Error('Invalid positive kopeck amount');
  return amount;
}
function tx(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function account(db, userId) {
  db.prepare('INSERT OR IGNORE INTO money_accounts(user_id) VALUES (?)').run(userId);
  return db.prepare('SELECT balance,reserved FROM money_accounts WHERE user_id=?').get(userId);
}
export function moneyBalance(db, userId) {
  const row = account(db, userId);
  return { balance: row.balance, reserved: row.reserved, available: row.balance - row.reserved };
}
function amountFromProvider(value) {
  if (typeof value !== 'string' || !/^\d+\.\d{2}$/.test(value)) throw Error('Provider amount malformed');
  const [rub, kop] = value.split('.');
  const amount = Number(rub) * 100 + Number(kop);
  return positive(amount);
}
function providerAmountMatches(object, expected) {
  return object?.amount?.currency === 'RUB' && amountFromProvider(object.amount.value) === expected;
}
function proofState(db,userId,habitId,day) {
  if (db.prepare('SELECT 1 FROM proof_skips WHERE user_id=? AND habit_id=? AND day=?').get(userId,habitId,day)) return 'skip';
  if (db.prepare("SELECT 1 FROM proofs WHERE user_id=? AND habit_id=? AND day=? AND status='approved'").get(userId,habitId,day)) return 'approved';
  if (db.prepare("SELECT 1 FROM proofs WHERE user_id=? AND habit_id=? AND day=? AND status='pending'").get(userId,habitId,day)) return 'pending';
  return 'none';
}

export function openMoneyPayment(db, { userId, amount, id = randomUUID() }) {
  positive(amount);
  if (amount < 5000 || amount > 5000000) throw Error('Topup outside allowed range');
  const key = `topup-${id}`;
  db.prepare(`INSERT INTO money_payment_intents(id,user_id,amount,provider,idempotency_key)
    VALUES (?, ?, ?, 'yookassa', ?)`).run(id, userId, amount, key);
  return { id, userId, amount, idempotencyKey: key };
}
export function attachProviderPayment(db, intentId, payment) {
  return tx(db, () => {
    const intent = db.prepare('SELECT * FROM money_payment_intents WHERE id=?').get(intentId);
    if (!intent) throw Error('Unknown payment intent');
    if (!payment?.id || !providerAmountMatches(payment, intent.amount) ||
        payment.metadata?.disbit_intent !== intent.id || payment.test === true) throw Error('Provider payment does not match intent');
    if (intent.provider_payment_id && intent.provider_payment_id !== payment.id) throw Error('Payment intent already bound');
    if (intent.status === 'succeeded' || intent.status === 'canceled') return { id:intent.id, providerId:payment.id, duplicate:true };
    db.prepare(`UPDATE money_payment_intents SET provider_payment_id=?, status='pending', confirmation_url=? WHERE id=?`)
      .run(payment.id, payment.confirmation?.confirmation_url || null, intent.id);
    return { id: intent.id, providerId: payment.id, url: payment.confirmation?.confirmation_url || null };
  });
}
// The caller MUST fetch this object from the authenticated provider GET API.
// A webhook body or browser return is never suitable input for this function.
export function confirmProviderPayment(db, payment) {
  return tx(db, () => {
    const intent = db.prepare('SELECT * FROM money_payment_intents WHERE provider_payment_id=?').get(payment?.id);
    if (!intent) return { ignored: true, reason: 'unknown-intent' };
    if (!providerAmountMatches(payment, intent.amount) || payment.metadata?.disbit_intent !== intent.id ||
        payment.test === true) throw Error('Verified payment mismatch');
    if (payment.status === 'canceled') {
      if (intent.status !== 'succeeded') db.prepare("UPDATE money_payment_intents SET status='canceled' WHERE id=?").run(intent.id);
      return { canceled: true };
    }
    if (payment.status !== 'succeeded' || payment.paid !== true) return { pending: true };
    if (intent.status === 'succeeded') return { duplicate: true };
    if (intent.status === 'canceled') throw Error('Canceled intent cannot be credited');
    const before = account(db, intent.user_id);
    const next = before.balance + intent.amount;
    if (!Number.isSafeInteger(next)) throw Error('Balance overflow');
    db.prepare('UPDATE money_accounts SET balance=? WHERE user_id=?').run(next, intent.user_id);
    db.prepare("INSERT INTO money_ledger(user_id,type,source_key,amount,balance_after) VALUES (?,'topup',?,?,?)")
      .run(intent.user_id, `topup:${intent.id}`, intent.amount, next);
    db.prepare("UPDATE money_payment_intents SET status='succeeded' WHERE id=?").run(intent.id);
    return { credited: true, balance: next };
  });
}

export function reserveMoneyRefund(db, { userId, amount, id = randomUUID() }) {
  positive(amount);
  return tx(db, () => {
    const before = account(db, userId);
    if (amount > before.balance - before.reserved) throw Error('Insufficient refundable balance');
    const payments = db.prepare(`SELECT p.id,p.amount FROM money_payment_intents p
      WHERE p.user_id=? AND p.status='succeeded' ORDER BY p.created_at,p.id`).all(userId);
    let left = amount;
    const parts = [];
    for (const payment of payments) {
      const used = db.prepare(`SELECT COALESCE(SUM(amount),0) AS amount FROM money_refund_parts
        WHERE payment_intent_id=? AND status!='failed'`).get(payment.id).amount;
      const take = Math.min(left, payment.amount - used);
      if (take > 0) {
        const partId = randomUUID();
        parts.push({ id: partId, paymentIntentId: payment.id, amount: take, idempotencyKey: `refund-${partId}` });
        left -= take;
      }
      if (!left) break;
    }
    if (left) throw Error('No matching original payments for full refund');
    db.prepare('INSERT INTO money_refund_requests(id,user_id,amount) VALUES (?,?,?)').run(id,userId,amount);
    for (const part of parts) db.prepare(`INSERT INTO money_refund_parts
      (id,request_id,payment_intent_id,amount,idempotency_key) VALUES (?,?,?,?,?)`)
      .run(part.id,id,part.paymentIntentId,part.amount,part.idempotencyKey);
    db.prepare('UPDATE money_accounts SET reserved=reserved+? WHERE user_id=?').run(amount,userId);
    return { id, parts };
  });
}
export function attachProviderRefund(db, partId, refund) {
  return tx(db, () => {
    const part = db.prepare(`SELECT r.*,p.provider_payment_id FROM money_refund_parts r
      JOIN money_payment_intents p ON p.id=r.payment_intent_id WHERE r.id=?`).get(partId);
    if (!part || !refund?.id || refund.payment_id !== part.provider_payment_id ||
        !providerAmountMatches(refund, part.amount)) throw Error('Provider refund does not match reservation');
    if (part.provider_refund_id && part.provider_refund_id !== refund.id) throw Error('Refund reservation already bound');
    if (part.status === 'succeeded' || part.status === 'failed') return { id:partId, providerId:refund.id, duplicate:true };
    db.prepare("UPDATE money_refund_parts SET provider_refund_id=?,status='pending' WHERE id=?")
      .run(refund.id,partId);
    return { id:partId, providerId:refund.id };
  });
}
function refreshRefundRequest(db, requestId) {
  const rows = db.prepare('SELECT status FROM money_refund_parts WHERE request_id=?').all(requestId);
  const status = rows.every(p=>p.status==='succeeded') ? 'succeeded' :
    rows.every(p=>p.status==='failed') ? 'failed' :
    rows.some(p=>p.status==='failed'||p.status==='succeeded') ? 'partial' : 'pending';
  db.prepare('UPDATE money_refund_requests SET status=? WHERE id=?').run(status,requestId);
  return status;
}
// As with payments, refund must come from provider GET or a confirmed create response.
export function confirmProviderRefund(db, refund) {
  return tx(db, () => {
    const part = db.prepare(`SELECT r.*,q.user_id,p.provider_payment_id FROM money_refund_parts r
      JOIN money_refund_requests q ON q.id=r.request_id
      JOIN money_payment_intents p ON p.id=r.payment_intent_id WHERE r.provider_refund_id=?`).get(refund?.id);
    if (!part) return { ignored:true, reason:'unknown-refund' };
    if (refund.payment_id !== part.provider_payment_id || !providerAmountMatches(refund,part.amount)) throw Error('Verified refund mismatch');
    if (part.status === 'succeeded' || part.status === 'failed') return { duplicate:true };
    if (!['succeeded','canceled'].includes(refund.status)) return { pending:true };
    const before = account(db,part.user_id);
    if (refund.status === 'succeeded') {
      if (before.reserved < part.amount || before.balance < part.amount) throw Error('Refund reserve invariant violated');
      const next = before.balance - part.amount;
      db.prepare('UPDATE money_accounts SET balance=?,reserved=reserved-? WHERE user_id=?').run(next,part.amount,part.user_id);
      db.prepare("INSERT INTO money_ledger(user_id,type,source_key,amount,balance_after) VALUES (?,'refund',?,?,?)")
        .run(part.user_id,`refund:${part.id}`,-part.amount,next);
      db.prepare("UPDATE money_refund_parts SET status='succeeded' WHERE id=?").run(part.id);
    } else {
      db.prepare('UPDATE money_accounts SET reserved=reserved-? WHERE user_id=?').run(part.amount,part.user_id);
      db.prepare("UPDATE money_refund_parts SET status='failed' WHERE id=?").run(part.id);
    }
    return { status:refreshRefundRequest(db,part.request_id), balance:moneyBalance(db,part.user_id) };
  });
}

export function settleMoneyPenalty(db, { userId, habitId, day, today }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= today) throw Error('Only a closed account day may settle');
  return tx(db, () => {
    const existing = db.prepare('SELECT status FROM money_penalties WHERE user_id=? AND habit_id=? AND day=?').get(userId,habitId,day);
    if (existing) return { duplicate:true, status:existing.status };
    const terms = db.prepare(`SELECT * FROM money_terms WHERE user_id=? AND habit_id=? AND effective_day<=?
      ORDER BY effective_day DESC LIMIT 1`).get(userId,habitId,day);
    if (!terms) return { ignored:true, reason:'no-accepted-terms' };
    const weekday = (new Date(day+'T12:00:00Z').getUTCDay()+6)%7;
    if (terms.week_target===0 && !JSON.parse(terms.schedule).includes(weekday)) return { ignored:true, reason:'not-scheduled' };
    if (terms.week_target>0) {
      const weekStart=new Date(Date.parse(day+'T12:00:00Z')-weekday*86400000).toISOString().slice(0,10);
      const completions=db.prepare('SELECT day,done,count FROM completions WHERE habit_id=? AND day>=? AND day<?').all(habitId,weekStart,day);
      let done=0;
      for(const c of completions) {
        if (!(c.done || (terms.goal_type==='count' && c.count>=terms.goal_target))) continue;
        const proof=proofState(db,userId,habitId,c.day);
        if (proof==='pending') return { ignored:true, reason:'proof-pending' };
        if (proof==='skip'||proof==='approved') done++;
      }
      const need=terms.week_target-done;
      if (need<=0 || need<7-weekday) return { ignored:true, reason:'weekly-slack' };
    }
    const habit = db.prepare('SELECT archive_periods FROM habits WHERE id=? AND user_id=?').get(habitId,userId);
    if (!habit) return { ignored:true, reason:'deleted-habit' };
    if (JSON.parse(habit.archive_periods||'[]').some(p=>day>=p.from&&(!p.to||day<p.to))) return { ignored:true, reason:'archived' };
    const completion = db.prepare('SELECT done,skip,count FROM completions WHERE habit_id=? AND day=?').get(habitId,day);
    if (db.prepare('SELECT 1 FROM promise_day_skips WHERE user_id=? AND habit_id=? AND day=?').get(userId,habitId,day))
      return { ignored:true, reason:'completed-or-skipped' };
    const proof=proofState(db,userId,habitId,day);
    if (proof==='pending') return { ignored:true, reason:'proof-pending' };
    if ((completion?.done || (terms.goal_type==='count' && completion?.count>=terms.goal_target)) &&
        (proof==='skip'||proof==='approved')) return { ignored:true, reason:'completed-or-skipped' };
    const before = account(db,userId);
    const status = before.balance-before.reserved>=terms.amount ? 'paid' : 'insufficient';
    const id = randomUUID();
    db.prepare(`INSERT INTO money_penalties(id,user_id,habit_id,day,terms_id,amount,status,reason)
      VALUES (?,?,?,?,?,?,?,'scheduled promise not completed')`)
      .run(id,userId,habitId,day,terms.id,terms.amount,status);
    if (status==='paid') {
      const next=before.balance-terms.amount;
      db.prepare('UPDATE money_accounts SET balance=? WHERE user_id=?').run(next,userId);
      db.prepare("INSERT INTO money_ledger(user_id,type,source_key,amount,balance_after) VALUES (?,'penalty',?,?,?)")
        .run(userId,`penalty:${userId}:${habitId}:${day}`,-terms.amount,next);
    }
    return { status, amount:terms.amount, balance:moneyBalance(db,userId) };
  });
}
