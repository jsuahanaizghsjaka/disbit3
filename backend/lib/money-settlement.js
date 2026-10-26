import { randomUUID } from 'node:crypto';
import { settleMoneyPenalty } from './money-core.js';

const nextDay = day => new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10);
function accountToday(zone, now) {
  try { return new Intl.DateTimeFormat('en-CA',{timeZone:zone||'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
  catch { return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
}

// Called only after the user explicitly accepts the new money agreement.
// Conditions take effect tomorrow: editing a promise cannot rewrite today's
// or yesterday's agreed amount. The public API/consent screen is still gated.
export function acceptMoneyTerms(db, { userId, habitId, agreementVersion, agreementHash, now = new Date() }) {
  if (!/^[a-zA-Z0-9._-]{1,40}$/.test(agreementVersion||'') || !/^[a-f0-9]{64}$/.test(agreementHash||''))
    throw Error('Published agreement version and SHA-256 are required');
  const habit = db.prepare('SELECT * FROM habits WHERE id=? AND user_id=?').get(habitId,userId);
  const user = db.prepare('SELECT time_zone FROM users WHERE id=?').get(userId);
  if (!habit || !user || habit.archived || habit.stake_mode!=='money' || habit.stake_recipient!=='creators')
    throw Error('Promise is not eligible for real-money terms');
  if (!Number.isInteger(habit.week_target) || habit.week_target<0 || habit.week_target>7) throw Error('Invalid weekly target');
  const amount = habit.stake_amount*100;
  if (!Number.isSafeInteger(amount) || amount<=0) throw Error('Invalid penalty amount');
  let effectiveDay = nextDay(accountToday(user.time_zone,now));
  // A flexible weekly goal starts on a full Monday-to-Sunday period.
  if (habit.week_target>0) while ((new Date(effectiveDay+'T12:00:00Z').getUTCDay()+6)%7!==0) effectiveDay=nextDay(effectiveDay);
  const id=randomUUID();
  db.prepare(`INSERT INTO money_terms(id,user_id,habit_id,effective_day,schedule,week_target,goal_type,goal_target,amount,recipient,agreement_version,agreement_hash)
    VALUES (?,?,?,?,?,?,?,?,?,'creators',?,?)
    ON CONFLICT(user_id,habit_id,effective_day) DO UPDATE SET
      id=excluded.id,schedule=excluded.schedule,week_target=excluded.week_target,
      goal_type=excluded.goal_type,goal_target=excluded.goal_target,
      amount=excluded.amount,agreement_version=excluded.agreement_version,agreement_hash=excluded.agreement_hash,
      accepted_at=datetime('now')`)
    .run(id,userId,habitId,effectiveDay,habit.schedule,habit.week_target,habit.goal_type,habit.goal_target,amount,agreementVersion,agreementHash);
  return { id:db.prepare('SELECT id FROM money_terms WHERE user_id=? AND habit_id=? AND effective_day=?').get(userId,habitId,effectiveDay).id,
    effectiveDay,amount };
}

// Bounded, retry-safe server scan. No date/amount/recipient comes from a phone.
// A pending proof blocks that promise's cursor, so
// a later run can reconsider it instead of silently charging or losing it.
export function settleClosedMoneyDays(db, { now = new Date(), maxDays = 31 } = {}) {
  if (!Number.isInteger(maxDays) || maxDays<1 || maxDays>366) throw Error('Invalid scan limit');
  const targets=db.prepare(`SELECT t.user_id,t.habit_id,MIN(t.effective_day) AS first_day,u.time_zone,c.last_day
    FROM money_terms t JOIN users u ON u.id=t.user_id
    LEFT JOIN money_settlement_cursors c ON c.user_id=t.user_id AND c.habit_id=t.habit_id
    GROUP BY t.user_id,t.habit_id`).all();
  const results=[];
  for(const target of targets) {
    const today=accountToday(target.time_zone,now);
    let day=target.last_day ? nextDay(target.last_day) : target.first_day;
    let processed=0;
    while(day<today && processed<maxDays) {
      const result=settleMoneyPenalty(db,{userId:target.user_id,habitId:target.habit_id,day,today});
      results.push({userId:target.user_id,habitId:target.habit_id,day,...result});
      if (result.reason==='proof-pending') break;
      db.prepare(`INSERT INTO money_settlement_cursors(user_id,habit_id,last_day) VALUES (?,?,?)
        ON CONFLICT(user_id,habit_id) DO UPDATE SET last_day=excluded.last_day`)
        .run(target.user_id,target.habit_id,day);
      day=nextDay(day); processed++;
    }
  }
  return results;
}
