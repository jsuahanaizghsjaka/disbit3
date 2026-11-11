const {test} = require('node:test');
const assert = require('node:assert/strict');
const base = () => ({habits:[{id:'a',createdAt:'2026-11-01',stake:{mode:'lock'},schedule:[0,1,2,3,4,5,6],goal:{type:'check'},history:{}}],today:'2026-11-08',startsAt:1000,endsAt:86401000,now:2000});
test('blocking: midnight start, inclusive start, exclusive 24-hour expiry', async()=>{
  const {restrictionDecision: decide}=await import('../backend/lib/blocking-policy.js');
  assert.equal(decide({...base(),now:999}).active,false);
  assert.equal(decide({...base(),now:1000}).active,true);
  assert.equal(decide({...base(),now:86401000}).active,false);
  assert.throws(()=>decide({...base(),endsAt:86401001}));
});
test('blocking: full-day skip, minimum and completed promise exempt restrictions', async()=>{
  const {restrictionDecision: decide}=await import('../backend/lib/blocking-policy.js');
  for(const day of ['2026-11-07','2026-11-08']) {
    assert.equal(decide({...base(),skippedDays:[day]}).active,false);
    for(const value of [true,'min','skip']) {
      const data=base(); data.habits[0].history[day]=value;
      assert.equal(decide(data).active,false);
    }
  }
});
test('blocking: unrelated completion does not clear another restriction; no money fallback', async()=>{
  const {restrictionDecision: decide}=await import('../backend/lib/blocking-policy.js');
  const data=base(); data.habits.push({...data.habits[0],id:'b',history:{'2026-11-08':true}});
  assert.deepEqual(decide(data).habitIds,['a']);
  data.habits[0].stake.mode='money'; assert.equal(decide(data).active,false);
});
test('blocking: archive, future creation, flexible schedule and count completion', async()=>{
  const {restrictionDecision: decide}=await import('../backend/lib/blocking-policy.js');
  for(const changes of [{archived:true},{createdAt:'2026-11-08'},{schedule:[0]},{weekTarget:1},{archivePeriods:[{from:'2026-11-01'}]}]) {
    const data=base();Object.assign(data.habits[0],changes);assert.equal(decide(data).active,false);
  }
  const data=base();data.habits[0].goal={type:'count',target:3}; data.habits[0].counts={'2026-11-08':2};
  assert.equal(decide(data).active,true); data.habits[0].counts['2026-11-08']=3;assert.equal(decide(data).active,false);
  assert.throws(()=>decide({...base(),today:'2026-02-30'}));
});
