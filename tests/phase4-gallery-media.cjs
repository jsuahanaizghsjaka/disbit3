// Explicit local integration check: requires ffmpeg/ffprobe on PATH.
const {spawn,execFileSync}=require('node:child_process');
const {mkdtempSync,readFileSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');const assert=require('node:assert/strict');
(async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'disbit-gallery-')),dbPath=path.join(dir,'test.db');let child;
 const results=[];
 try{
  for(const [name,seconds] of [['short.mov',1],['long.mp4',16]])execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=64x64:r=10','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t',String(seconds),'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',path.join(dir,name)],{windowsHide:true,timeout:30000});
  child=spawn(process.execPath,[path.join(__dirname,'recovery-fixture.mjs')],{env:{...process.env,PORT:'3506',DB_PATH:dbPath,PROOFS_DIR:path.join(dir,'proofs'),ADMIN_KEY:'synthetic-gallery-admin-1234567890'},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),15000);child.stdout.on('data',b=>{if(String(b).includes('localhost:3506')){clearTimeout(t);resolve();}});child.on('exit',()=>{clearTimeout(t);reject(Error('exit'));});});
  const db=new DatabaseSync(dbPath);const day=new Date().toISOString().slice(0,10);
  db.prepare("UPDATE users SET time_zone='UTC' WHERE id=1").run();db.prepare('INSERT INTO habits(id,user_id,name,created_day) VALUES(?,?,?,?)').run('media',1,'Synthetic media',day);db.close();
  for(const [file,mime,expected] of [['short.mov','video/quicktime',201],['long.mp4','video/mp4',400]]){
   const r=await fetch('http://127.0.0.1:3506/api/proofs?habitId=media&day='+day+'&type=video&source=gallery',{method:'POST',headers:{Authorization:'Bearer '+'1'.repeat(64),'Content-Type':mime,'X-Time-Zone':'UTC'},body:readFileSync(path.join(dir,file))});
   const body=await r.json();assert.equal(r.status,expected,JSON.stringify(body));results.push({file,status:r.status});
  }
  const list=await(await fetch('http://127.0.0.1:3506/api/proofs',{headers:{'X-Admin-Key':'synthetic-gallery-admin-1234567890'}})).json();
  assert.equal(list.items.length,1);assert.equal(list.items[0].source,'gallery');
  const media=await fetch('http://127.0.0.1:3506/api/proofs/'+list.items[0].id+'/media',{headers:{'X-Admin-Key':'synthetic-gallery-admin-1234567890'}});
  assert.equal(media.status,200);assert.ok(media.headers.get('content-type').startsWith('video/quicktime'));
  assert.equal((await fetch('http://127.0.0.1:3506/api/proofs/'+list.items[0].id+'/media',{headers:{Authorization:'Bearer '+'2'.repeat(64)}})).status,401);
  const report={ok:true,results,sourceSaved:true,adminMedia:true,foreignUserDenied:true,note:'Generated local media with audio; no iPhone hardware tested.'};
  writeFileSync(path.join(__dirname,'../test-results/phase4-gallery-media.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{if(child?.exitCode===null){const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped;}}
})().catch(e=>{console.error(e);process.exitCode=1;});
