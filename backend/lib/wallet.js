/* ============================================================
   Кошелёк (депозит). Все суммы — КОПЕЙКИ, целые числа.

   Почему депозит, а не автосписание с карты:
   • нет рекуррентных платежей → не нужна привязка карты и согласие на списания;
   • деньги уже у нас на момент штрафа → списание не может «не пройти»;
   • пользователь всегда видит, сколько на кону, и может вывести остаток.

   Все изменения баланса идут ТОЛЬКО через credit/debit — они пишут
   транзакцию и новый баланс одной операцией, чтобы история всегда сходилась.
   ============================================================ */

import { db } from '../db/db.js';

export function ensureWallet(userId) {
  db.prepare('INSERT OR IGNORE INTO wallets (user_id, balance) VALUES (?, 0)').run(userId);
}

export function getBalance(userId) {
  ensureWallet(userId);
  const row = db.prepare('SELECT balance, currency FROM wallets WHERE user_id = ?').get(userId);
  return { balance: row?.balance || 0, currency: row?.currency || 'RUB' };
}

function writeTx(userId, type, amount, balanceAfter, opts = {}) {
  const info = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (user_id, type, amount, balance_after, status, provider, provider_id, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId, type, amount, balanceAfter,
    opts.status || 'done', opts.provider || null, opts.providerId || null,
    opts.meta ? JSON.stringify(opts.meta) : null
  );
  return info.changes > 0;      // 0 = такой платёж уже проводили (повторный вебхук)
}

/* Пополнение. Возвращает false, если платёж с этим provider_id уже зачислен. */
export function credit(userId, amount, opts = {}) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('amount должен быть целым > 0');
  ensureWallet(userId);

  // идемпотентность: если такой платёж уже проводили — второй раз не зачисляем
  if (opts.provider && opts.providerId) {
    const dup = db.prepare(
      'SELECT id FROM transactions WHERE provider = ? AND provider_id = ?'
    ).get(opts.provider, opts.providerId);
    if (dup) return { ok: false, duplicate: true, ...getBalance(userId) };
  }

  const tx = db.prepare('BEGIN IMMEDIATE');
  try {
    tx.run();
    const cur = db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(userId).balance;
    const next = cur + amount;
    db.prepare("UPDATE wallets SET balance = ?, updated_at = datetime('now') WHERE user_id = ?")
      .run(next, userId);
    writeTx(userId, 'topup', amount, next, opts);
    db.prepare('COMMIT').run();
    return { ok: true, balance: next };
  } catch (e) {
    try { db.prepare('ROLLBACK').run(); } catch {}
    throw e;
  }
}

/* Списание штрафа с депозита. Не хватает — НЕ уводим баланс в минус:
   возвращаем ok:false, а штраф остаётся неоплаченным (клиент это покажет). */
export function debit(userId, amount, opts = {}) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('amount должен быть целым > 0');
  ensureWallet(userId);

  try {
    db.prepare('BEGIN IMMEDIATE').run();
    const cur = db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(userId).balance;
    if (cur < amount) {
      db.prepare('COMMIT').run();
      return { ok: false, reason: 'insufficient', balance: cur, needed: amount };
    }
    const next = cur - amount;
    db.prepare("UPDATE wallets SET balance = ?, updated_at = datetime('now') WHERE user_id = ?")
      .run(next, userId);
    writeTx(userId, opts.type || 'charge', -amount, next, opts);
    db.prepare('COMMIT').run();
    return { ok: true, balance: next };
  } catch (e) {
    try { db.prepare('ROLLBACK').run(); } catch {}
    throw e;
  }
}

export function history(userId, limit = 50) {
  return db.prepare(`
    SELECT id, type, amount, balance_after, status, provider, meta, created_at
    FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?
  `).all(userId, limit).map(r => ({
    ...r,
    meta: (() => { try { return r.meta ? JSON.parse(r.meta) : null; } catch { return null; } })()
  }));
}

/* Сколько уже «на кону» — сумма списанных штрафов (для экрана и отчётов) */
export function chargedTotal(userId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(-amount), 0) AS total FROM transactions
    WHERE user_id = ? AND type = 'charge' AND status = 'done'
  `).get(userId);
  return row?.total || 0;
}
