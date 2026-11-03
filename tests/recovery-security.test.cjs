const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');

test('recovery: privacy, mail failure, account binding, revocation, expiry, limits survive restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disbit-recovery-security-'));
  const database = path.join(dir, 'test.db');
  let child, logs = '', mails = [];
  const start = async () => {
    child = fork(path.join(__dirname, 'recovery-fixture.mjs'), [], {silent:true,
      env:{...process.env, DB_PATH:database, PORT:'3461'}});
    child.on('message', value => { if(value.type==='mail') mails.push(value.mail); });
    await new Promise((resolve,reject) => {
      const timer=setTimeout(()=>reject(Error('startup timeout')),15000);
      child.stdout.on('data',data=>{logs+=data;if(String(data).includes('localhost:3461')){clearTimeout(timer);resolve();}});
      child.stderr.on('data',data=>{logs+=data;});
      child.once('error',reject);
      child.once('exit',()=>{clearTimeout(timer);reject(Error('fixture exited'));});
    });
  };
  const stop = async () => { if(child?.exitCode===null) {const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;} };
  const call = async (route, body, session='') => {
    const r=await fetch('http://127.0.0.1:3461/api'+route,{method:body===undefined?'GET':'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+session},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')};
  };
  const request = email => call('/auth/password-reset/request',{email});
  const change = (token,email='recovery_one@example.org',session='') => call('/auth/password-reset/confirm',{token,email,password:'New-test-pass-43'},session);
  const update = sql => { const db=new DatabaseSync(database);try {db.exec(sql);}finally{db.close();} };
  const tokenOf = mail => /<p>([a-f0-9]{64})<\/p>/.exec(mail.html)[1];
  try {
    await start();
    const known=await request('recovery_one@example.org');
    assert.equal(known.status,200);assert.equal(known.cache,'no-store');
    for(const email of ['missing@example.org','unverified@example.org','bad']) assert.deepEqual(await request(email),known);
    assert.equal(mails.length,1);
    const code=tokenOf(mails[0]);
    assert.equal((await change(code,'recovery_two@example.org')).status,400);
    assert.equal((await change(code,'recovery_one@example.org','2'.repeat(64))).status,400);
    assert.equal((await change('0'.repeat(64))).status,400);
    assert.equal((await change(code)).status,200);
    assert.equal((await call('/auth/me',undefined,'1'.repeat(64))).status,401);
    assert.equal((await call('/auth/me',undefined,'2'.repeat(64))).status,200);
    assert.equal((await call('/auth/login',{id:'recovery_one',password:'Old-test-pass-42'})).status,401);
    assert.equal((await call('/auth/login',{id:'recovery_one',password:'New-test-pass-43'})).status,200);
    assert.equal((await change(code)).status,400);
    // Unknown and registered addresses share the same persisted request limits.
    await request('recovery_one@example.org');
    update('UPDATE password_resets SET sent_at=0');
    await request('recovery_one@example.org');
    const count=mails.length;
    await stop();await start();
    assert.deepEqual(await request('recovery_one@example.org'),known);
    assert.equal(mails.length,count);
    const db=new DatabaseSync(database);
    const digest=createHash('sha256').update('f'.repeat(64)).digest('hex');
    db.prepare('UPDATE password_resets SET token_hash=?,expires_at=0 WHERE user_id=1').run(digest);db.close();
    assert.equal((await change('f'.repeat(64))).status,400);
    // SMTP failure never leaks the account or secret; a later resend can work.
    await new Promise(resolve=>{child.once('message',resolve);child.send({type:'fail',value:true});});
    assert.deepEqual(await request('recovery_two@example.org'),known);
    const inspect=new DatabaseSync(database);assert.equal(inspect.prepare('SELECT * FROM password_resets WHERE user_id=2').get(),undefined);inspect.close();
    await new Promise(resolve=>{child.once('message',resolve);child.send({type:'fail',value:false});});
    await request('recovery_two@example.org');
    assert.equal((await change(tokenOf(mails.at(-1)),'recovery_two@example.org')).status,200);
    for(let i=0;i<31;i++) await change('0'.repeat(64));
    assert.equal((await change('0'.repeat(64))).status,429);
    await stop();await start();
    assert.equal((await change('0'.repeat(64))).status,429);
    assert(logs.includes('[mail] password reset delivery failed'));
    for(const secret of ['synthetic-secret','Old-test-pass-42','New-test-pass-43',...mails.map(tokenOf)]) assert(!logs.includes(secret),'sensitive content in logs');
  } finally {await stop();}
});
