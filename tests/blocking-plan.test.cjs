const {test}=require('node:test');const assert=require('node:assert/strict');
test('server restriction interval follows account timezone and never exceeds 24 hours',async()=>{
 const {accountInterval}=await import('../backend/lib/blocking-plan.js');
 for(const zone of ['Europe/Moscow','Asia/Vladivostok','America/New_York'])for(const instant of ['2026-11-01T12:00:00Z','2026-03-08T12:00:00Z']){
  const now=Date.parse(instant),i=accountInterval(now,zone);assert.ok(i.startsAt<=now);assert.ok(i.endsAt-i.startsAt<=86400000);assert.ok(i.endsAt>i.startsAt);
 }
 assert.equal(accountInterval(Date.parse('2026-11-14T22:00:00Z'),'Europe/Moscow').today,'2026-11-15');
});
test('plan exposes independent reasons and full-day exemption',async()=>{
 const {buildBlockingPlan}=await import('../backend/lib/blocking-plan.js');
 const base={now:Date.parse('2026-11-14T12:00:00Z'),timeZone:'Europe/Moscow',habits:['a','b'].map(id=>({id,stake:{mode:'lock'},schedule:[0,1,2,3,4,5,6],createdAt:'2026-11-01',history:{},goal:{type:'check'}})),skippedDays:[]};
 assert.equal(buildBlockingPlan(base).windows.length,2);
 base.habits[0].history['2026-11-14']=true;assert.deepEqual(buildBlockingPlan(base).habitIds,['b']);
 base.skippedDays=['2026-11-14'];assert.equal(buildBlockingPlan(base).windows.length,0);
});
