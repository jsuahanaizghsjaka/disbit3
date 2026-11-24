// Disposable local server only. Closed-loop concurrency, not a production capacity claim.
const {spawn}=require('node:child_process');
const {mkdtempSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
(async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'disbit-load-')),file=path.join(dir,'test.db');
 const child=spawn(process.execPath,[path.join(__dirname,'recovery-fixture.mjs')],{env:{...process.env,PORT:'3505',DB_PATH:file,PROOFS_DIR:path.join(dir,'proofs')},stdio:['ignore','pipe','pipe']});
 let logs='';child.stderr.on('data',b=>logs+=b);
 try {
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup')),15000);child.stdout.on('data',b=>{if(String(b).includes('localhost:3505')){clearTimeout(timer);resolve();}});child.on('exit',()=>{clearTimeout(timer);reject(Error('exit'));});});
  const db=new DatabaseSync(file);
  for(let i=10;i<60;i++){
   db.prepare('INSERT INTO users(id,login,email,pass_hash,pass_salt) VALUES(?,?,?,?,?)').run(i,'load_'+i,'load_'+i+'@example.invalid','fixture','fixture');
   db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(String(i).padStart(64,'0'),i,Date.now()+3600000);
  }db.close();
  const runs=[];
  for(const concurrency of [10,25,50]){
   const samples=[],statuses={};const started=performance.now();
   await Promise.all(Array.from({length:concurrency},async(_,i)=>{
    const token=String(i+10).padStart(64,'0');
    for(let j=0;j<40;j++){
     const write=j%5===0,route=write?'/state':j%2?'/habits?includeArchived=1':'/state',t=performance.now();
     const r=await fetch('http://127.0.0.1:3505/api'+route,{method:write?'PUT':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:write?JSON.stringify({data:{settings:{qa:j}},ts:Date.now()}):undefined,signal:AbortSignal.timeout(15000)});
     await r.text();samples.push(performance.now()-t);statuses[r.status]=(statuses[r.status]||0)+1;
    }
   }));
   samples.sort((a,b)=>a-b);const elapsed=performance.now()-started;
   runs.push({concurrency,requests:samples.length,statuses,elapsedMs:elapsed,requestsPerSecond:samples.length*1000/elapsed,p50:samples[Math.floor(samples.length*.5)],p95:samples[Math.ceil(samples.length*.95)-1],max:samples.at(-1)});
  }
  const inspect=new DatabaseSync(file);const integrity=inspect.prepare('PRAGMA integrity_check').get();inspect.close();
  const report={environment:'Windows localhost, one Node process, temporary SQLite; 80% reads / 20% writes, no think time',node:process.version,runs,integrity,sqliteBusy:/SQLITE_BUSY|database is locked/.test(logs)};
  writeFileSync(path.join(__dirname,'../test-results/phase4-load.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  if(report.sqliteBusy||runs.some(r=>Object.keys(r.statuses).some(s=>s!=='200')))process.exitCode=1;
 }finally{child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
