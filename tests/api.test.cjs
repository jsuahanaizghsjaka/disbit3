const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
let server;
const base = 'http://127.0.0.1:3439/api';
const request = (method, route, body, token = '1'.repeat(64)) => fetch(base + route, {
  method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Time-Zone': Intl.DateTimeFormat().resolvedOptions().timeZone },
  body: body === undefined ? undefined : JSON.stringify(body)
});
before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, 'fixture-server.mjs')], {
    env: { ...process.env, PORT: '3439' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Fixture startup timed out')), 15000);
    server.stdout.on('data', data => {
      if (String(data).includes('http://localhost:3439')) { clearTimeout(timeout); resolve(); }
    });
    server.on('error', reject);
    server.on('exit', code => { clearTimeout(timeout); reject(new Error(`Fixture exit ${code}`)); });
  });
});
after(() => server?.kill());

test('health identifies contract and release; readiness checks the database', async () => {
  const health = await request('GET','/health');
  assert.equal(health.headers.get('cache-control'),'no-store');
  assert.equal(health.headers.get('x-powered-by'),null);
  const body = await health.json();
  assert.equal(body.apiVersion,1);
  assert.equal(body.capabilities.proofSkipsPerMonth,5);
  assert.equal(body.capabilities.livePayments,false);
  assert.equal((await request('GET','/ready')).status,200);
  assert.equal((await request('POST','/wallet/webhook',{event:'payment.succeeded'})).status,503);
});

test('completed count survives API reload and explicit undo', async () => {
  const today = new Date().toLocaleDateString('en-CA');
  assert.equal((await request('POST','/proofs/skip',{habitId:'beta-count',day:today})).status,200);
  assert.equal((await request('PUT', `/habits/beta-count/day/${today}`, { done: true, count: 2 })).status, 200);
  let h = (await (await request('GET', '/habits')).json()).find(h => h.id === 'beta-count');
  assert.equal(h.history[today], true);
  assert.equal(h.counts[today], 2);
  await request('PUT', `/habits/beta-count/day/${today}`, { done: false, count: 1 });
  h = (await (await request('GET', '/habits')).json()).find(h => h.id === 'beta-count');
  assert.equal(h.history[today], undefined);
  assert.equal(h.counts[today], 1);
});

test('unsupported blocking cannot be enabled; legacy records stay editable without penalties', async () => {
  const all = await (await request('GET', '/habits')).json();
  const h = all.find(h => h.id === 'beta-check');
  assert.equal((await request('POST', '/habits', { ...h, id: 'new-lock', stake: { mode: 'lock' } })).status, 422);
  assert.equal((await request('PUT', '/habits/beta-check', { ...h, stake: { mode: 'lock' } })).status, 422);
  const legacy = all.find(h => h.id === 'beta-lock');
  assert.equal((await request('PUT', '/habits/beta-lock', { ...legacy, name: 'Legacy edited' })).status, 200);
  const result = await (await request('POST', '/charges', [{ habitId: legacy.id, day: legacy.createdAt }])).json();
  assert.equal(result.added, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.charged, 0);
});

test('new promises preserve color; history import and duplicate ids cannot backdate completion', async () => {
  const h = (await (await request('GET', '/habits')).json())[0];
  const today = new Date().toLocaleDateString('en-CA');
  const body = { ...h, id: 'import-test', color: '#EF4444', history: { [h.createdAt]: 'skip', [today]: true } };
  assert.equal((await request('POST', '/habits', body)).status, 422);
  assert.equal((await request('POST', '/habits', {...body,history:{},counts:{}})).status, 201);
  assert.equal((await request('POST', '/habits', body)).status, 409);
  const stored = (await (await request('GET', '/habits')).json()).find(h => h.id === body.id);
  assert.deepEqual(stored.history, {});
  assert.equal(stored.color, '#EF4444');
});

test('friends add mutually, reject self and remove', async () => {
  assert.equal((await request('POST', '/friends', { login: 'beta_tester' })).status, 400);
  assert.equal((await request('POST', '/friends', { login: 'beta_friend' })).status, 201);
  const data = await (await request('GET', '/friends')).json();
  assert.equal(data.friends[0].streak, 12);
  const reverse = await (await request('GET', '/friends', undefined, '2'.repeat(64))).json();
  assert.equal(reverse.friends[0].login, 'beta_tester');
  assert.equal(reverse.friends[0].streak ?? null, null, 'missing published progress must not become a zero streak');
  assert.equal((await request('DELETE', '/friends/beta_friend')).status, 200);
  assert.equal((await (await request('GET', '/friends')).json()).friends.length, 0);
});

test('archive is reversible, isolated and excludes paused days from charges', async () => {
  const source = (await (await request('GET','/habits')).json()).find(h=>h.id==='beta-check');
  const day = new Date().toLocaleDateString('en-CA');
  await request('POST','/habits',{...source,id:'archive-test',history:{},counts:{}});
  assert.equal((await request('PUT','/habits/archive-test/archive',{archived:true,day},'2'.repeat(64))).status,404);
  assert.equal((await request('PUT','/habits/archive-test/archive',{archived:true,day:'2000-01-01'})).status,400);
  let h = await (await request('PUT','/habits/archive-test/archive',{archived:true,day})).json();
  assert.equal(h.archived,true); assert.deepEqual(h.history,{});
  h = await (await request('PUT','/habits/archive-test/archive',{archived:true,day})).json();
  assert.equal(h.archivePeriods.length,1,'archive must be idempotent');
  assert(!(await (await request('GET','/habits')).json()).some(h=>h.id==='archive-test'));
  assert((await (await request('GET','/habits?includeArchived=1')).json()).some(h=>h.id==='archive-test'&&h.archived));
  assert.equal((await request('PUT',`/habits/archive-test/day/${day}`,{done:true})).status,409);
  const charge = await (await request('POST','/charges',[{habitId:'archive-test',day}])).json();
  assert.equal(charge.added,0); assert.equal(charge.charged,0);
  h = await (await request('PUT','/habits/archive-test/archive',{archived:false,day})).json();
  assert.equal(h.archived,false); assert.deepEqual(h.archivePeriods,[{from:day,to:day}]);
  assert.deepEqual(h.history,{});
  await request('POST','/proofs/skip',{habitId:'archive-test',day});
  assert.equal((await request('PUT',`/habits/archive-test/day/${day}`,{done:true})).status,200);
});

test('deletion respects ownership and removes completion history', async () => {
  assert.equal((await request('DELETE', '/habits/import-test', undefined, '2'.repeat(64))).status, 404);
  assert.equal((await request('DELETE', '/habits/import-test')).status, 204);
  assert.equal((await (await request('GET', '/habits')).json()).some(h => h.id === 'import-test'), false);
});

test('past and future days are read-only; count cannot bypass proof requirement', async () => {
  const today=new Date().toLocaleDateString('en-CA');
  for(const offset of [-2,-1,1]) {
    const day=new Date(Date.now()+offset*86400000).toLocaleDateString('en-CA');
    assert.equal((await request('PUT',`/habits/beta-check/day/${day}`,{done:true})).status,403);
    assert.equal((await request('POST','/proofs/skip',{habitId:'beta-check',day})).status,403);
  }
  await request('POST','/habits',{id:'count-gate',name:'Count gate',goal:{type:'count',target:2}});
  assert.equal((await request('PUT',`/habits/count-gate/day/${today}`,{done:false,count:2})).status,409);
  assert.equal((await request('PUT',`/habits/count-gate/day/${today}`,{done:false,count:1})).status,200);
  assert.equal((await request('PUT',`/habits/beta-check/day/${today}`,{done:true})).status,409);
});

test('five proof skips: per-account, persistent, idempotent, concurrent last slot and no deletion refund', async () => {
  const day=new Date().toLocaleDateString('en-CA');
  let q=await (await request('GET','/proofs/quota')).json();
  assert.equal(q.limit,5); const initial=q.used;
  assert.equal((await request('POST','/proofs/skip',{habitId:'beta-check',day},'2'.repeat(64))).status,404);
  for(let i=0;i<5;i++) await request('POST','/habits',{id:`quota-${i}`,name:`Quota ${i}`});
  for(let i=initial;i<4;i++) assert.equal((await request('POST','/proofs/skip',{habitId:`quota-${i}`,day})).status,200);
  const final=await Promise.all(['quota-0','quota-1'].map(habitId=>request('POST','/proofs/skip',{habitId,day})));
  assert.deepEqual(final.map(r=>r.status).sort(),[200,409]);
  const winner=final[0].status===200?'quota-0':'quota-1';
  assert.equal((await request('POST','/proofs/skip',{habitId:winner,day})).status,200);
  q=await (await request('GET','/proofs/quota')).json(); assert.equal(q.used,5);assert.equal(q.remaining,0);
  assert.equal((await request('PUT',`/habits/${winner}/day/${day}`,{done:true})).status,200);
  await request('PUT',`/habits/${winner}/day/${day}`,{done:false});
  await request('DELETE',`/habits/${winner}`);
  assert.equal((await (await request('GET','/proofs/quota')).json()).remaining,0);
  assert.equal((await (await request('GET','/proofs/quota',undefined,'2'.repeat(64))).json()).remaining,5);
});

test('proof upload ownership, date, MIME and completion after quota is exhausted', async () => {
  const day=new Date().toLocaleDateString('en-CA');
  const upload=(habitId,day,mime='image/png',token='1'.repeat(64))=>fetch(base+`/proofs?habitId=${habitId}&day=${day}&type=photo`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':mime},
    body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
  });
  assert.equal((await upload('beta-check',day,'image/png','2'.repeat(64))).status,404);
  assert.equal((await upload('beta-check','2000-01-01')).status,403);
  assert.equal((await upload('beta-check',day,'application/octet-stream')).status,415);
  assert.equal((await fetch(base+`/proofs?habitId=beta-check&day=${day}`,{method:'POST',headers:{Authorization:'Bearer '+'1'.repeat(64),'Content-Type':'image/png'},body:'not an image'})).status,415);
  assert.equal((await upload('beta-check',day)).status,201);
  assert.equal((await request('PUT',`/habits/beta-check/day/${day}`,{done:true})).status,200);
  assert.equal((await (await request('GET','/proofs/quota')).json()).used,5);
});

test('minimum description and minimum mark survive API reload', async()=>{
  const day=new Date().toLocaleDateString('en-CA');
  const token='2'.repeat(64);
  const body={id:'minimum-test',name:'Прочитать главу',min:'Прочитать страницу'};
  assert.equal((await request('POST','/habits',body,token)).status,201);
  await request('POST','/proofs/skip',{habitId:body.id,day},token);
  assert.equal((await request('PUT',`/habits/${body.id}/day/${day}`,{done:true,minimum:true},token)).status,200);
  const stored=(await (await request('GET','/habits',undefined,token)).json()).find(h=>h.id===body.id);
  assert.equal(stored.min,body.min);assert.equal(stored.history[day],'min');
});

test('invitation acceptance still creates a promise after minimum schema migration', async()=>{
  const source={id:'invite-minimum',name:'Совместное чтение',min:'Одна страница'};
  await request('POST','/habits',source);
  const invitation=await (await request('POST','/invites',{habitId:source.id})).json();
  const response=await request('POST',`/invites/${invitation.code}/accept`,{},'2'.repeat(64));
  assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.habit.min,source.min);assert.deepEqual(result.habit.history,{});
});
