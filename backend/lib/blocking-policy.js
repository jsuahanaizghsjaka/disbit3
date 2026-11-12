// Pure decision layer. Not yet exposed as an enabled penalty API: native
// scheduling, consent and device receipts must be integrated before release.
const DAY = 86400000;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
function date(day) {
  if (typeof day !== 'string' || !dayPattern.test(day)) throw Error('Invalid account day');
  const value = new Date(day + 'T00:00:00Z');
  if (!Number.isFinite(+value) || value.toISOString().slice(0, 10) !== day) throw Error('Invalid account day');
  return value;
}
function done(h, day) {
  const mark = h.history?.[day];
  if (mark === 'skip') return false;
  if (mark === 'min') return true;
  return h.goal?.type === 'count' ? Number(h.counts?.[day] || 0) >= Number(h.goal.target) : mark === true;
}
function required(h, day) {
  if (h.archived || h.createdAt > day || (h.archivePeriods || []).some(p => day >= p.from && (!p.to || day < p.to))) return false;
  const d = date(day), weekday = (d.getUTCDay() + 6) % 7;
  if (!h.weekTarget) return Array.isArray(h.schedule) && h.schedule.includes(weekday);
  let completed = 0;
  for (let i = 1; i <= weekday; i++) {
    if (done(h, new Date(+d - i * DAY).toISOString().slice(0, 10))) completed++;
  }
  return Number(h.weekTarget) - completed >= 7 - weekday;
}

/** Account timezone midnight instants are resolved by the caller, never device time.
 * All outstanding lock promises must be resolved; completing an unrelated one
 * cannot unlock the device. A full-day skip exempts all promises for that day.
 */
export function restrictionDecision({ habits, today, startsAt, endsAt, now, skippedDays = [] }) {
  const d = date(today);
  if (![startsAt, endsAt, now].every(Number.isFinite) || endsAt <= startsAt || endsAt - startsAt > DAY) {
    throw Error('Invalid restriction interval');
  }
  const yesterday = new Date(+d - DAY).toISOString().slice(0, 10);
  if (now < startsAt || now >= endsAt || skippedDays.includes(yesterday) || skippedDays.includes(today)) {
    return { active: false, habitIds: [], startsAt, endsAt };
  }
  const habitIds = habits.filter(h => h.stake?.mode === 'lock'
    && required(h, yesterday) && !done(h, yesterday) && h.history?.[yesterday] !== 'skip'
    && !done(h, today) && h.history?.[today] !== 'skip').map(h => h.id);
  return { active: habitIds.length > 0, habitIds, startsAt, endsAt };
}
