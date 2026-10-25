export const FREE_MONTHLY_SKIPS = 5;
export const MAX_BOUGHT_SKIPS = 3;
export const SKIP_COST_BITS = 20;

export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function promiseSkipQuota(db, userId, day) {
  const month = day.slice(0, 7);
  const used = db.prepare('SELECT COUNT(*) AS n FROM promise_day_skips WHERE user_id=? AND month=?').get(userId, month).n;
  const bought = db.prepare('SELECT COUNT(*) AS n FROM promise_skip_purchases WHERE user_id=? AND month=?').get(userId, month).n;
  const balance = db.prepare('SELECT balance FROM trusted_bits WHERE user_id=?').get(userId)?.balance ?? 0;
  return { month, free: FREE_MONTHLY_SKIPS, bought, maxBought: MAX_BOUGHT_SKIPS,
    used, remaining: Math.max(0, FREE_MONTHLY_SKIPS + bought - used), costBits: SKIP_COST_BITS, trustedBits: balance };
}

// Call inside the same write transaction as the completion. Repeating the same
// promise/day consumes no additional quota; a different promise does.
export function recordPromiseSkip(db, userId, habitId, day) {
  if (db.prepare('SELECT 1 FROM promise_day_skips WHERE user_id=? AND habit_id=? AND day=?').get(userId,habitId,day))
    return promiseSkipQuota(db,userId,day);
  const quota = promiseSkipQuota(db,userId,day);
  if (quota.remaining <= 0) throw Error('Лимит пропусков обещаний на этот месяц исчерпан');
  db.prepare('INSERT INTO promise_day_skips(user_id,habit_id,day,month) VALUES (?,?,?,?)')
    .run(userId,habitId,day,quota.month);
  return promiseSkipQuota(db,userId,day);
}

export function purchasePromiseSkip(db, userId, day, requestId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId || ''))
    throw Error('Нужен идентификатор запроса покупки');
  return transaction(db, () => {
    const existing = db.prepare('SELECT user_id FROM promise_skip_purchases WHERE id=?').get(requestId);
    if (existing) {
      if (existing.user_id !== userId) throw Error('Идентификатор покупки уже используется');
      return { ...promiseSkipQuota(db,userId,day), duplicate:true };
    }
    const quota = promiseSkipQuota(db,userId,day);
    if (quota.bought >= MAX_BOUGHT_SKIPS) throw Error('Можно купить не более трёх пропусков за месяц');
    if (quota.trustedBits < SKIP_COST_BITS) throw Error('Недостаточно подтверждённых битов');
    db.prepare('UPDATE trusted_bits SET balance=balance-? WHERE user_id=?').run(SKIP_COST_BITS,userId);
    db.prepare('INSERT INTO promise_skip_purchases(id,user_id,month,cost_bits) VALUES (?,?,?,?)')
      .run(requestId,userId,quota.month,SKIP_COST_BITS);
    return promiseSkipQuota(db,userId,day);
  });
}

// Negative balances are permitted after an undo: spent bits become a debt, so
// completion/undo cycling cannot mint a second purchase.
export function syncTrustedBitAward(db, userId, habitId, day, completed) {
  const exists = !!db.prepare('SELECT 1 FROM trusted_bit_awards WHERE user_id=? AND habit_id=? AND day=?').get(userId,habitId,day);
  if (exists === completed) return;
  db.prepare('INSERT OR IGNORE INTO trusted_bits(user_id) VALUES (?)').run(userId);
  if (completed) db.prepare('INSERT INTO trusted_bit_awards(user_id,habit_id,day) VALUES (?,?,?)').run(userId,habitId,day);
  else db.prepare('DELETE FROM trusted_bit_awards WHERE user_id=? AND habit_id=? AND day=?').run(userId,habitId,day);
  db.prepare('UPDATE trusted_bits SET balance=balance+? WHERE user_id=?').run(completed ? 1 : -1,userId);
}

export function revokeHabitBitAwards(db, userId, habitId) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM trusted_bit_awards WHERE user_id=? AND habit_id=?').get(userId,habitId).n;
  if (!count) return;
  db.prepare('DELETE FROM trusted_bit_awards WHERE user_id=? AND habit_id=?').run(userId,habitId);
  db.prepare('UPDATE trusted_bits SET balance=balance-? WHERE user_id=?').run(count,userId);
}
