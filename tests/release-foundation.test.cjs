const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { spawn } = require('node:child_process');

test('hosted staging starts isolated, rejects topup and fake webhook, preserves data on restart', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'disbit-staging-'));
  const database = path.join(dir,'disbit.db');
  fs.mkdirSync(path.join(dir,'proofs'));
  const db = new DatabaseSync(database);
  db.exec(fs.readFileSync(path.join(__dirname,'../backend/db/schema.sql'),'utf8'));
  db.exec("INSERT INTO users(id,login,email,pass_hash,pass_salt) VALUES(1,'staging','staging@example.invalid','hash','salt')");
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,1,?)').run('a'.repeat(64),Date.now()+60000);
  db.close();
  const env = {...process.env,NODE_ENV:'production',APP_ENV:'staging',PORT:'3441',HOST:'127.0.0.1',
    DB_PATH:database,PROOFS_DIR:path.join(dir,'proofs'),PUBLIC_URL:'https://staging.disbit.ru',
    RELEASE_SHA:'7cfcc70',ADMIN_KEY:'x'.repeat(32),PAYMENTS_PROVIDER:'disabled',
    RESEND_API_KEY:'',POSTMARK_TOKEN:'',SENDGRID_API_KEY:''};
  for(let run=0;run<2;run++) {
    const child=spawn(process.execPath,['backend/server.js'],{env,stdio:['ignore','pipe','pipe']});
    let logs='';child.stderr.on('data',data=>{logs+=data;});
    try {
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('Staging startup timed out')),15000);
        child.stdout.on('data',data=>{if(String(data).includes('localhost:3441')){clearTimeout(timer);resolve();}});
        child.once('error',error=>{clearTimeout(timer);reject(error);});
        child.once('exit',code=>{clearTimeout(timer);reject(Error('Staging exited '+code));});
      });
      const base='http://127.0.0.1:3441/api';
      assert.equal((await (await fetch(base+'/health')).json()).environment,'staging');
      const headers={'Content-Type':'application/json',Authorization:'Bearer '+'a'.repeat(64)};
      assert.equal((await fetch(base+'/wallet/topup',{method:'POST',headers,body:'{"amount":5000}'})).status,503);
      assert.equal((await fetch(base+'/wallet/webhook',{method:'POST',headers,body:'{"event":"payment.succeeded"}'})).status,503);
      const wallet=await (await fetch(base+'/wallet',{headers})).json();
      assert.equal(wallet.balance,0);assert.equal(wallet.payments.available,false);
      assert.equal((await (await fetch(base+'/auth/me',{headers})).json()).user.login,'staging');
      if(run===0) assert.equal((await fetch(base+'/auth/resend',{method:'POST',headers})).status,502);
      assert(!logs.includes('[mail:dev]'),'Email verification code leaked to hosted logs');
    } finally {
      const exited = new Promise(resolve=>child.once('exit',resolve));
      if(child.exitCode===null){child.kill();await exited;}
    }
  }
});

test('hosted config fails closed before any DB is opened', async () => {
  const { validateRuntime } = await import('../backend/lib/runtime.js');
  assert.equal(validateRuntime({}).provider, 'manual');
  const env = { NODE_ENV:'production', APP_ENV:'staging', DB_PATH:path.resolve('/data/staging.db'),
    PROOFS_DIR:path.resolve('/data/proofs'), PUBLIC_URL:'https://staging.disbit.ru',
    RELEASE_SHA:'7cfcc70', ADMIN_KEY:'x'.repeat(32) };
  assert.equal(validateRuntime(env).provider, 'disabled');
  for (const bad of [{PAYMENTS_PROVIDER:'manual'}, {PAYMENTS_PROVIDER:'yookassa'}, {PAYMENTS_PROVIDER:'typo'},
    {APP_ENV:'development'}, {DB_PATH:'relative.db'}, {PUBLIC_URL:'https://disbit.ru'}, {ADMIN_KEY:''}, {RELEASE_SHA:''}]) {
    assert.throws(() => validateRuntime({...env,...bad}));
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'disbit-invalid-'));
  const file = path.join(dir,'must-not-exist.db');
  const result = spawnSync(process.execPath,['backend/server.js'], {env:{...process.env,...env,DB_PATH:file,PAYMENTS_PROVIDER:'manual'},encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.equal(fs.existsSync(file),false);
});

test('offline snapshot restores SQLite, WAL data and media; tampering and overwrite rejected', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const { createBackup, verifyBackup, restoreBackup } = await import('../scripts/backup.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'disbit-restore-'));
  const source = path.join(root,'source'); fs.mkdirSync(source);
  const proofs = path.join(source,'proofs');fs.mkdirSync(proofs);
  fs.writeFileSync(path.join(proofs,'proof.png'),Buffer.from([137,80,78,71,13,10]));
  const database = path.join(source,'disbit.db');
  const db = new DatabaseSync(database);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE users(id INTEGER PRIMARY KEY, login TEXT); CREATE TABLE proofs(file TEXT); INSERT INTO users VALUES(1,'synthetic'); INSERT INTO proofs VALUES('proof.png')");
  const backup = path.join(root,'backup');
  assert.throws(()=>createBackup({database,proofs,destination:backup}));
  assert.equal(createBackup({database,proofs,destination:backup,offline:true}).ok,true);
  db.close();
  const restored = path.join(root,'restored');
  assert.equal(restoreBackup(backup,restored).ok,true);
  const copy = new DatabaseSync(path.join(restored,'disbit.db'),{readOnly:true});
  assert.equal(copy.prepare('SELECT login FROM users').get().login,'synthetic');copy.close();
  assert.deepEqual(fs.readFileSync(path.join(restored,'proofs/proof.png')),fs.readFileSync(path.join(proofs,'proof.png')));
  assert.throws(()=>restoreBackup(backup,restored));
  assert.throws(()=>createBackup({database,proofs,destination:path.join(source,'nested'),offline:true}));
  fs.appendFileSync(path.join(backup,'proofs/proof.png'),'changed');
  assert.throws(()=>verifyBackup(backup),/Checksum/);
  assert.throws(()=>restoreBackup(backup,path.join(root,'bad')));
  assert.equal(fs.existsSync(path.join(root,'bad')),false);
});

test('existing SQLite schema upgrades idempotently without losing historical rows', () => {
  const { DatabaseSync } = require('node:sqlite');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'disbit-migration-'));
  const database=path.join(root,'old.db');const db=new DatabaseSync(database);
  db.exec(fs.readFileSync(path.join(__dirname,'../backend/db/schema.sql'),'utf8'));
  db.exec("INSERT INTO users(id,login,email,pass_hash,pass_salt) VALUES(9,'legacy','legacy@example.invalid','hash','salt'); INSERT INTO habits(id,user_id,name,created_day) VALUES('legacy',9,'Old habit','2026-10-01'); INSERT INTO completions(habit_id,day,done) VALUES('legacy','2026-10-01',1)");db.close();
  for(let i=0;i<2;i++) {
    const r=spawnSync(process.execPath,['--input-type=module','-e',"const {db}=await import('./backend/db/db.js'); db.close();"],{env:{...process.env,DB_PATH:database},encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);
  }
  const migrated=new DatabaseSync(database);
  assert.equal(migrated.prepare('SELECT count(*) AS n FROM completions WHERE done=1').get().n,1);
  for(const [table,column] of [['habits','minimum_action'],['completions','minimum'],['users','time_zone']]) assert(migrated.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column));
  migrated.close();
});
