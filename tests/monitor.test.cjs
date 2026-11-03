const {test}=require('node:test');
const assert=require('node:assert/strict');
test('monitor detects downtime, low space, restarts and mail errors without message content',async()=>{
  const {monitorIssues}=await import('../scripts/monitor.mjs');
  const good={checks:{local:true,https:true},disk:{available:2*1024**3,percent:80},units:{disbit:{active:'active',restarts:0,started:'1'}},mailFailures:0};
  assert.deepEqual(monitorIssues(good),[]);
  assert.deepEqual(monitorIssues({...good,checks:{https:false}}),['unavailable:https']);
  assert.deepEqual(monitorIssues({...good,disk:{available:100,percent:89}}),['disk:low']);
  assert.deepEqual(monitorIssues({...good,disk:{available:2*1024**3,percent:90}}),['disk:low']);
  assert.deepEqual(monitorIssues({...good,mailFailures:2}),['mail:delivery-failed']);
  assert.deepEqual(monitorIssues(good,{units:{disbit:{restarts:0,started:'0'}}}),['restart:disbit']);
  assert.deepEqual(monitorIssues({...good,units:{disbit:{active:'failed',restarts:0,started:'1'}}}),['service:disbit']);
});
