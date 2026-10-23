import { db } from './db/db.js';

export const PROOF_SKIP_LIMIT = 5;

// Capture an account's timezone once, not a client-supplied date on every mark.
// A later device/timezone change cannot reopen yesterday's history.
export function accountDay(req, now = new Date()) {
  let zone = db.prepare('SELECT time_zone FROM users WHERE id = ?').get(req.userId)?.time_zone;
  if (!zone) {
    zone = req.headers['x-time-zone'] || 'Europe/Moscow';
    try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(now); }
    catch { zone = 'Europe/Moscow'; }
    db.prepare('UPDATE users SET time_zone = ? WHERE id = ? AND time_zone IS NULL').run(zone, req.userId);
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit' }).format(now);
}

export function proofSatisfied(userId, habitId, day) {
  return !!db.prepare('SELECT 1 FROM proof_skips WHERE user_id=? AND habit_id=? AND day=?').get(userId, habitId, day) ||
    !!db.prepare("SELECT 1 FROM proofs WHERE user_id=? AND habit_id=? AND day=? AND status IN ('pending','approved')").get(userId, habitId, day);
}

export function proofQuota(userId, day) {
  const used = db.prepare('SELECT COUNT(*) AS n FROM proof_skips WHERE user_id=? AND month=?').get(userId, day.slice(0,7)).n;
  return { limit: PROOF_SKIP_LIMIT, used, remaining: Math.max(0, PROOF_SKIP_LIMIT-used), month: day.slice(0,7), today:day };
}
