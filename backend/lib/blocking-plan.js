import {restrictionDecision} from './blocking-policy.js';
export function accountInterval(now,timeZone){
 const format=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
 const today=format.format(now), date=Date.parse(today+'T00:00:00Z');
 function boundary(day){let lo=date-36*3600000,hi=date+60*3600000;while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(format.format(mid)<day)lo=mid;else hi=mid;}return hi;}
 const tomorrow=new Date(date+86400000).toISOString().slice(0,10);
 const startsAt=boundary(today),endsAt=Math.min(boundary(tomorrow),startsAt+86400000);
 return {today,startsAt,endsAt};
}
export function buildBlockingPlan({habits,skippedDays,timeZone,now=Date.now()}){
 const interval=accountInterval(now,timeZone);
 const decision=restrictionDecision({...interval,now,habits,skippedDays});
 return {serverNow:now,timeZone,today:interval.today,...decision,windows:decision.habitIds.map(habitId=>({habitId,startsAt:interval.startsAt,endsAt:interval.endsAt,reason:'missed_promise'}))};
}
