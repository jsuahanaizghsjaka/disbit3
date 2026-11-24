// Automatic app restriction: enrolment, consent, per-promise plan, receipts, revocation.
// Synthetic localhost fixtures only.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtempSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const one='1'.repeat(64),two='2'.repeat(64),servers=[];let db;
const on='http://127.0.0.1:3511',off='http://127.0.0.1:3512';
const install=n=>('installation-'+n).padEnd(24,'x');
function start(port,extra){
 const dir=mkdtempSync(path.join(tmpdir(),'disbit-enroll-'));
 const child=spawn(process.execPath,[path.join(__dirname,'recovery-fixture.mjs')],{env:{...process.env,PORT:String(port),DB_PATH:path.join(dir,'test.db'),PROOFS_DIR:path.join(dir,'proofs'),...extra},stdio:['ignore','pipe','pipe']});
 servers.push(child);
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),15000);child.stdout.on('data',b=>{if(String(b).includes('localhost:'+port)){clearTimeout(timer);resolve(dir);}});child.on('exit',code=>{clearTimeout(timer);reject(Error('fixture exit '+code));});});
}
const call=async(base,method,route,body,token=one,headers={})=>{
 const response=await fetch(base+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Time-Zone':'Europe/Moscow',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,body:await response.json().catch(()=>null),headers:response.headers};
};
const enroll=(n,token=one,more={})=>call(on,'POST','/api/blocking/devices',{platform:'android',installationId:install(n),consentVersion:2,label:'Galaxy A22',appVersion:'1.0.8',...more},token);
before(async()=>{
 const dir=await start(3511,{BLOCKING_ENFORCEMENT:'1'});await start(3512,{BLOCKING_ENFORCEMENT:''});
 db=new DatabaseSync(path.join(dir,'test.db'));db.exec('PRAGMA busy_timeout=5000');
});
after(()=>{db?.close();for(const child of servers)child.kill();});

test('without the server switch everything stays a preview and lock promises are refused',async()=>{
 const enrolled=await call(off,'POST','/api/blocking/devices',{platform:'android',installationId:install('off'),consentVersion:2});
 assert.equal(enrolled.status,201);assert.equal(enrolled.body.enforcement,false);
 const plan=await call(off,'GET','/api/blocking/plan?deviceId='+enrolled.body.device.id);
 assert.equal(plan.body.enabled,false);assert.equal(plan.body.enrollment,'disabled');assert.deepEqual(plan.body.windows,[]);
 const habit=await call(off,'POST','/api/habits',{name:'Lock',stake:{mode:'lock',apps:['com.instagram.android'],minutes:60}});
 assert.equal(habit.status,422);assert.equal(habit.body.code,'blocking_disabled');
});

test('enrolment needs a session, a valid installation id and the current consent',async()=>{
 assert.equal((await call(on,'POST','/api/blocking/devices',{platform:'android',installationId:install('a'),consentVersion:2},'')).status,401);
 assert.equal((await enroll('a',one,{platform:'ios'})).body.code,'platform_unsupported');
 assert.equal((await enroll('a',one,{installationId:'short'})).status,400);
 assert.equal((await enroll('a',one,{installationId:{toString:1}})).status,400);
 const outdated=await enroll('a',one,{consentVersion:0});
 assert.equal(outdated.status,409);assert.equal(outdated.body.requiredConsentVersion,2);
 assert.equal((await enroll('a',one,{consentVersion:'2'})).status,409);
 assert.equal(db.prepare('SELECT count(*) n FROM blocking_devices').get().n,0);
 const before=await call(on,'GET','/api/blocking/plan');
 assert.equal(before.body.enabled,false);assert.equal(before.body.enrollment,'enrollment_required');assert.equal(before.headers.get('cache-control'),'no-store');
 const lockless=await call(on,'POST','/api/habits',{name:'Lock',stake:{mode:'lock',apps:['com.instagram.android']}});
 assert.equal(lockless.body.code,'device_required');
 const first=await enroll('a');assert.equal(first.status,201);assert.equal(first.body.enforcement,true);assert.equal(first.body.device.current,true);
 const again=await enroll('a',one,{label:'Renamed\u0000 phone'});assert.equal(again.status,200);assert.equal(again.body.device.id,first.body.device.id);assert.equal(again.body.device.label,'Renamed phone');
 const stored=db.prepare('SELECT * FROM blocking_devices').get();
 assert.match(stored.session_hash,/^sha256:/);assert.equal(stored.consent_version,2);assert.ok(stored.consent_at>0);
});

test('a lock promise needs a restrictable app; the plan is per promise, bounded and account-isolated',async()=>{
 const device=(await enroll('a')).body.device.id;
 assert.equal((await call(on,'POST','/api/habits',{name:'No apps',stake:{mode:'lock',apps:[]}})).body.code,'apps_required');
 assert.equal((await call(on,'POST','/api/habits',{name:'Only protected',stake:{mode:'lock',apps:['io.disbit.app','com.android.settings','com.google.android.dialer','not a package']}})).body.code,'apps_required');
 const a=await call(on,'POST','/api/habits',{id:'lock-a',name:'Read',stake:{mode:'lock',apps:['com.instagram.android','com.android.settings','io.disbit.app','com.instagram.android'],minutes:60}});
 const b=await call(on,'POST','/api/habits',{id:'lock-b',name:'Run',stake:{mode:'lock',apps:['org.telegram.messenger'],minutes:60}});
 assert.equal(a.status,201);assert.equal(b.status,201);
 let plan=(await call(on,'GET','/api/blocking/plan?deviceId='+device)).body;
 assert.equal(plan.enabled,true);assert.equal(plan.active,false,'a promise created today has no missed yesterday');
 db.prepare("UPDATE habits SET created_day='2026-01-01' WHERE id IN ('lock-a','lock-b')").run();
 const started=Date.now();
 plan=(await call(on,'GET','/api/blocking/plan',undefined,one,{'X-Disbit-Device':device})).body;
 assert.equal(plan.mode,'enforced');assert.equal(plan.active,true);
 assert.deepEqual(plan.windows.map(w=>w.habitId).sort(),['lock-a','lock-b']);
 const read=plan.windows.find(w=>w.habitId==='lock-a');
 assert.deepEqual(read.apps,['com.instagram.android']);assert.equal(read.reason,'missed_promise');assert.equal(read.name,'Read');
 assert.deepEqual(plan.apps.sort(),['com.instagram.android','org.telegram.messenger']);
 assert.ok(read.endsAt-read.startsAt<=86400000);
 assert.ok(plan.validUntil<=read.endsAt&&plan.validUntil<=Date.now()+2*3600000&&plan.validUntil>started);
 assert.ok(plan.refreshAfter<plan.validUntil||plan.validUntil===read.endsAt);
 assert.match(plan.planVersion,/^[0-9a-f]{16}$/);
 // another account: neither the device id nor the promises leak
 const foreign=(await call(on,'GET','/api/blocking/plan?deviceId='+device,undefined,two)).body;
 assert.equal(foreign.enabled,false);assert.equal(foreign.enrollment,'enrollment_required');assert.deepEqual(foreign.windows,[]);assert.deepEqual(foreign.preview.habitIds,[]);
 assert.equal((await call(on,'DELETE','/api/blocking/devices/'+device,undefined,two)).status,404);
 assert.equal((await call(on,'POST',`/api/blocking/devices/${device}/receipts`,{planVersion:plan.planVersion,state:'applied'},two)).status,404);
 // completing one promise releases only that promise; a full-day skip releases all
 const {accountInterval}=await import('../backend/lib/blocking-plan.js');
 const {today}=accountInterval(Date.now(),'Europe/Moscow');
 db.prepare('INSERT INTO completions(habit_id,day,done) VALUES(?,?,1)').run('lock-a',today);
 const partial=(await call(on,'GET','/api/blocking/plan?deviceId='+device)).body;
 assert.deepEqual(partial.windows.map(w=>w.habitId),['lock-b']);assert.deepEqual(partial.apps,['org.telegram.messenger']);assert.notEqual(partial.planVersion,plan.planVersion);
 db.prepare('INSERT INTO promise_full_day_skips(user_id,day,month) VALUES(1,?,?)').run(today,today.slice(0,7));
 const released=(await call(on,'GET','/api/blocking/plan?deviceId='+device)).body;
 assert.equal(released.enabled,true);assert.equal(released.active,false);assert.deepEqual(released.windows,[]);assert.deepEqual(released.apps,[]);
 db.prepare('DELETE FROM promise_full_day_skips').run();db.prepare('DELETE FROM completions').run();
});

test('receipts are validated, stored per device and readable only by the owner',async()=>{
 const device=(await enroll('a')).body.device.id;
 const plan=(await call(on,'GET','/api/blocking/plan?deviceId='+device)).body;
 assert.equal((await call(on,'POST',`/api/blocking/devices/${device}/receipts`,{planVersion:plan.planVersion,state:'applied',habitIds:['lock-a','lock-b',{x:1}]})).status,201);
 for(const bad of [{planVersion:plan.planVersion,state:'unlocked'},{planVersion:'nope',state:'applied'},{state:'applied'},[]])assert.equal((await call(on,'POST',`/api/blocking/devices/${device}/receipts`,bad)).status,400);
 const list=await call(on,'GET',`/api/blocking/devices/${device}/receipts`);
 assert.equal(list.body.items.length,1);assert.deepEqual(list.body.items[0].habitIds,['lock-a','lock-b']);assert.equal(list.body.items[0].state,'applied');
 assert.equal((await call(on,'GET',`/api/blocking/devices/${device}/receipts`,undefined,two)).status,404);
 assert.equal(db.prepare('SELECT last_plan_version v FROM blocking_devices WHERE id=?').get(device).v,plan.planVersion);
});

test('logout, a newer consent text, an account change on the phone and removal all end enforcement',async()=>{
 // a second session of the same account enrols another phone, then logs out
 const session=(await call(on,'POST','/api/auth/login',{id:'recovery_one',password:'Old-test-pass-42'},'')).body.token;
 const second=(await enroll('b',session)).body.device.id;
 assert.equal((await call(on,'GET','/api/blocking/plan?deviceId='+second,undefined,session)).body.enabled,true);
 // the device id is not a credential: another session of the same account cannot use it
 assert.equal((await call(on,'GET','/api/blocking/plan?deviceId='+second)).body.enrollment,'session_changed');
 assert.equal((await call(on,'POST','/api/auth/logout',{},session)).status,200);
 const devices=(await call(on,'GET','/api/blocking/devices')).body;
 assert.deepEqual(devices.devices.map(d=>d.id).includes(second),false);assert.equal(devices.consentVersion,2);
 // stored consent older than the current text
 const first=(await enroll('a')).body.device.id;
 db.prepare('UPDATE blocking_devices SET consent_version=0 WHERE id=?').run(first);
 const stale=(await call(on,'GET','/api/blocking/plan?deviceId='+first)).body;
 assert.equal(stale.enabled,false);assert.equal(stale.enrollment,'consent_outdated');assert.deepEqual(stale.windows,[]);
 assert.equal((await enroll('a')).status,200);
 assert.equal((await call(on,'GET','/api/blocking/plan?deviceId='+first)).body.enabled,true);
 // the same phone under another account
 const taken=await enroll('a',two);assert.equal(taken.status,201);assert.notEqual(taken.body.device.id,first);
 assert.equal((await call(on,'GET','/api/blocking/plan?deviceId='+first)).body.enrollment,'enrollment_required');
 assert.deepEqual((await call(on,'GET','/api/blocking/plan?deviceId='+taken.body.device.id,undefined,two)).body.windows,[]);
 // explicit removal and the device limit
 assert.equal((await call(on,'DELETE','/api/blocking/devices/'+taken.body.device.id,undefined,two)).status,200);
 assert.equal((await call(on,'GET','/api/blocking/plan?deviceId='+taken.body.device.id,undefined,two)).body.enabled,false);
 for(let n=0;n<5;n++)assert.ok((await enroll('limit'+n)).status<300);
 const sixth=await enroll('limit6');assert.equal(sixth.status,409);assert.equal(sixth.body.code,'device_limit');
 // erasing the account takes the devices and receipts with it
 db.prepare('DELETE FROM users WHERE id=2').run();
 assert.equal(db.prepare('SELECT count(*) n FROM blocking_devices WHERE user_id=2').get().n,0);
});

test('existing promises cannot be switched to lock without a usable phone',async()=>{
 const plain=await call(on,'POST','/api/habits',{id:'plain-two',name:'Plain'},one);
 assert.equal(plain.status,201);
 db.prepare('DELETE FROM blocking_devices').run();
 const switched=await call(on,'PUT','/api/habits/plain-two',{name:'Plain',stake:{mode:'lock',apps:['com.instagram.android']}});
 assert.equal(switched.status,422);assert.equal(switched.body.code,'device_required');
});
