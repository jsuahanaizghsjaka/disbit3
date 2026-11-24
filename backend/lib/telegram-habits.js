/* Обещания «на сегодня» и серия для бота Telegram. Правила повторяют frontend/script.js
   (isScheduledOn / isRequiredOn / calculateStreak), чтобы /today и /stats в боте
   совпадали с приложением. Дни — строки YYYY-MM-DD по часовому поясу аккаунта. */
import { db } from '../db/db.js';
import { proofSatisfied } from '../proof-policy.js';

const DAY = 86400000;
const keyToMs = key => Date.parse(key + 'T12:00:00Z');
const msToKey = ms => new Date(ms).toISOString().slice(0, 10);
export const addDays = (key, n) => msToKey(keyToMs(key) + n * DAY);
// 0 = понедельник … 6 = воскресенье (как dayIdx на клиенте)
const dayIdx = key => (new Date(keyToMs(key)).getUTCDay() + 6) % 7;

export function zoneOf(userId) {
  const zone = db.prepare('SELECT time_zone FROM users WHERE id=?').get(userId)?.time_zone || 'Europe/Moscow';
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); return zone; } catch { return 'Europe/Moscow'; }
}
export function localParts(zone, now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
export const hhmmToMinutes = value => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

function loadHabit(row) {
  const marks = new Map(db.prepare('SELECT * FROM completions WHERE habit_id=?').all(row.id).map(c => [c.day, c]));
  return { row, marks, periods: JSON.parse(row.archive_periods || '[]'), schedule: JSON.parse(row.schedule || '[0,1,2,3,4,5,6]') };
}
const paused = (h, key) => h.periods.some(p => key >= p.from && (!p.to || key < p.to));
const isSkip = (h, key) => !!h.marks.get(key)?.skip;
function doneOn(h, key) {
  const m = h.marks.get(key);
  if (!m || m.skip) return false;
  if (h.row.goal_type === 'count') return m.done === 1 || (m.count || 0) >= h.row.goal_target;
  return !!m.done;
}
const flexible = h => Number(h.row.week_target) > 0;
function doneInWeekBefore(h, key) {
  const start = addDays(key, -dayIdx(key));
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const k = addDays(start, i);
    if (k >= key) break;
    if (doneOn(h, k)) n++;
  }
  return n;
}
function scheduledOn(h, key) {
  if (paused(h, key)) return doneOn(h, key);
  if (flexible(h)) return doneInWeekBefore(h, key) < Number(h.row.week_target);
  return h.schedule.includes(dayIdx(key));
}
function requiredOn(h, key) {
  if (paused(h, key)) return false;
  if (!flexible(h)) return h.schedule.includes(dayIdx(key));
  const need = Number(h.row.week_target) - doneInWeekBefore(h, key);
  if (need <= 0) return false;
  return need >= 7 - dayIdx(key);
}

export function streakOf(h, today) {
  let streak = 0, misses = 0, key = today;
  if (scheduledOn(h, key) && !doneOn(h, key)) key = addDays(key, -1);   // сегодня не судим
  for (let i = 0; i < 3660; i++) {
    if (key < h.row.created_day) break;
    if (isSkip(h, key)) { /* пропуск: серия стоит */ }
    else if (flexible(h)) {
      if (doneOn(h, key)) { streak++; misses = 0; }
      else if (requiredOn(h, key)) { misses++; if (misses >= 2) break; }
    } else if (scheduledOn(h, key)) {
      if (doneOn(h, key)) { streak++; misses = 0; }
      else { misses++; if (misses >= 2) break; }
    }
    key = addDays(key, -1);
  }
  return streak;
}

/* Обещания, которые нужно отметить в этот день (не в архиве, созданы не позже дня). */
export function habitsForDay(userId, day) {
  const rows = db.prepare('SELECT * FROM habits WHERE user_id=? AND archived=0 AND created_day<=? ORDER BY created_at').all(userId, day);
  const out = [];
  for (const row of rows) {
    const h = loadHabit(row);
    if (!scheduledOn(h, day)) continue;
    const mark = h.marks.get(day);
    out.push({
      id: row.id, name: row.name, minimumAction: row.minimum_action || '',
      done: doneOn(h, day), minimum: !!(mark && mark.done && mark.minimum), skipped: !!mark?.skip,
      punished: (row.stake_mode === 'money' && row.stake_amount > 0) || row.stake_mode === 'lock',
      proofReady: proofSatisfied(userId, row.id, day),
      streak: streakOf(h, day)
    });
  }
  return out;
}

export function weekSummary(userId, today) {
  const start = addDays(today, -dayIdx(today));
  let done = 0, planned = 0;
  for (const row of db.prepare('SELECT * FROM habits WHERE user_id=? AND archived=0 AND created_day<=?').all(userId, today)) {
    const h = loadHabit(row);
    for (let i = 0; i < 7; i++) {
      const k = addDays(start, i);
      if (k > today || k < row.created_day) break;
      if (doneOn(h, k)) { done++; planned++; }
      else if (!isSkip(h, k) && (flexible(h) ? requiredOn(h, k) : scheduledOn(h, k)) && k < today) planned++;
    }
  }
  return { done, planned, pct: planned ? Math.round(done / planned * 100) : 0 };
}

export function streakList(userId, today) {
  return db.prepare('SELECT * FROM habits WHERE user_id=? AND archived=0 AND created_day<=? ORDER BY created_at').all(userId, today)
    .map(row => ({ name: row.name, streak: streakOf(loadHabit(row), today) }));
}
