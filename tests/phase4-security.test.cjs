const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtempSync,readdirSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
test('login and proof limits persist; wrong owners, forged media and oversized uploads are rejected',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'disbit-phase4-')),file=path.join(dir,'test.db');let child;
 const start=async()=>{child=spawn(process.execPath,[path.join(__dirname,'recovery-fixture.mjs')],{env:{...process.env,PORT:'3504',ADMIN_KEY:'synthetic-phase4-admin-key-1234567890',DB_PATH:file,PROOFS_DIR:path.join(dir,'proofs')},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup')),15000);child.stdout.on('data',b=>{if(String(b).includes('localhost:3504')){clearTimeout(timer);resolve();}});child.on('exit',()=>{clearTimeout(timer);reject(Error('exit'));});});};
 const stop=async()=>{const end=new Promise(r=>child.once('exit',r));child.kill();await end;};
 const login=()=>fetch('http://127.0.0.1:3504/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'absent',password:'synthetic'})});
 const upload=(body,habit='own',mime='image/png')=>fetch('http://127.0.0.1:3504/api/proofs?habitId='+habit+'&day='+day,{method:'POST',headers:{Authorization:'Bearer '+'1'.repeat(64),'Content-Type':mime},body});
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow'}).format(new Date());
 try {
  await start();let db=new DatabaseSync(file);
  const state=async(body)=>fetch('http://127.0.0.1:3504/api/state',{method:body?'PUT':'GET',headers:{Authorization:'Bearer '+'1'.repeat(64),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  assert.equal((await state({data:{settings:{theme:'dark'}},ts:100,baseUpdatedAt:null})).status,200);
  assert.equal((await state({data:{settings:{theme:'light'}},ts:101,baseUpdatedAt:'100'})).status,200);
  assert.equal((await state({data:{settings:{theme:'lost'}},ts:102,baseUpdatedAt:'100'})).status,409);
  assert.equal((await state({data:{settings:{theme:'old-client'}},ts:99})).status,409);
  assert.equal((await state({data:{},ts:'Infinity'})).status,400);
  assert.equal((await state({data:{},ts:Date.now()+86400000})).status,400);
  assert.equal((await(await state()).json()).data.settings.theme,'light');
  db.prepare("UPDATE users SET time_zone='Europe/Moscow'").run();
  db.prepare('INSERT INTO habits(id,user_id,name,created_day) VALUES(?,?,?,?)').run('own',1,'Own',day);
  db.prepare('INSERT INTO habits(id,user_id,name,created_day) VALUES(?,?,?,?)').run('other',2,'Other',day);db.close();
  for(let i=0;i<15;i++)assert.equal((await login()).status,401);
  assert.equal((await login()).status,429);await stop();await start();
  const limited=await login();assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);
  assert.equal((await upload(Buffer.from('fake'),'other')).status,404);
  assert.equal((await upload(Buffer.from('fake'))).status,415);
  assert.equal((await upload(Buffer.alloc(5*1024*1024+1))).status,413);
  assert.equal((await upload(Buffer.alloc(10*1024*1024+1))).status,413);
  await new Promise(resolve=>{
    const req=require('node:http').request('http://127.0.0.1:3504/api/proofs?habitId=own&day='+day,{method:'POST',headers:{Authorization:'Bearer '+'1'.repeat(64),'Content-Type':'image/png','Content-Length':'10000'}});
    req.on('error',()=>resolve());req.write(Buffer.alloc(100));setTimeout(()=>req.destroy(),50);
  });
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(readdirSync(path.join(dir,'proofs')).length,0,'interrupted upload left media');
  for(let i=0;i<26;i++)await upload(Buffer.from('fake'));
  assert.equal((await upload(Buffer.from('fake'))).status,429);
  await stop();await start();assert.equal((await upload(Buffer.from('fake'))).status,429);
  assert.equal(readdirSync(path.join(dir,'proofs')).length,0);
  db=new DatabaseSync(file);db.exec('DELETE FROM request_limits');db.close();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  for(const source of ['gallery','camera','unknown'])assert.equal((await upload(png,'own&source='+source)).status,201);
  assert.equal((await upload(png,'own&source=forged')).status,400);
  assert.equal((await fetch('http://127.0.0.1:3504/api/proofs')).status,401);
  const listed=await (await fetch('http://127.0.0.1:3504/api/proofs',{headers:{'X-Admin-Key':'synthetic-phase4-admin-key-1234567890'}})).json();
  assert.deepEqual(listed.items.map(p=>p.source),['unknown','camera','gallery']);
 } finally {if(child?.exitCode===null)await stop();}
});

