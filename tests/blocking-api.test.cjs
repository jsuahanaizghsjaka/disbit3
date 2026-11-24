const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtempSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const dir=mkdtempSync(path.join(tmpdir(),'disbit-blocking-'));
let server,db;
const request=(token='1'.repeat(64))=>fetch('http://127.0.0.1:3498/api/blocking/plan',{headers:{Authorization:'Bearer '+token}});
before(async()=>{
 server=spawn(process.execPath,[path.join(__dirname,'recovery-fixture.mjs')],{env:{...process.env,PORT:'3498',DB_PATH:path.join(dir,'test.db'),PROOFS_DIR:path.join(dir,'proofs')},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),15000);server.stdout.on('data',b=>{if(String(b).includes('localhost:3498')){clearTimeout(timer);resolve();}});server.on('exit',code=>{clearTimeout(timer);reject(Error('server exit '+code));});});
 db=new DatabaseSync(path.join(dir,'test.db'));
 db.prepare("UPDATE users SET time_zone='Europe/Moscow'").run();
 const insert=db.prepare("INSERT INTO habits(id,user_id,name,created_day,stake_mode) VALUES(?,?,?,'2026-01-01',?)");
 insert.run('lock-a',1,'One','lock');insert.run('lock-b',1,'Two','lock');
 insert.run('lock-other',2,'Other account','lock');insert.run('money',1,'Money','money');
});
after(()=>{db?.close();server?.kill();});
test('blocking plan requires authentication and isolates account data',async()=>{
 assert.equal((await request('')).status,401);
 const response=await request();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const plan=await response.json();assert.equal(plan.enabled,false);assert.equal(plan.mode,'preview');assert.deepEqual(plan.windows,[]);
 assert.deepEqual(plan.preview.habitIds.sort(),['lock-a','lock-b']);
 assert.deepEqual((await(await request('2'.repeat(64))).json()).preview.habitIds,['lock-other']);
});
test('server completion releases one promise; full day skip releases every promise',async()=>{
 const {accountInterval}=await import('../backend/lib/blocking-plan.js');
 const {today}=accountInterval(Date.now(),'Europe/Moscow');
 db.prepare('INSERT INTO completions(habit_id,day,done) VALUES(?,?,1)').run('lock-a',today);
 assert.deepEqual((await(await request()).json()).preview.habitIds,['lock-b']);
 db.prepare('INSERT INTO promise_full_day_skips(user_id,day,month) VALUES(1,?,?)').run(today,today.slice(0,7));
 assert.deepEqual((await(await request()).json()).preview.habitIds,[]);
 assert.deepEqual((await(await request('2'.repeat(64))).json()).preview.habitIds,['lock-other']);
});
