// Live deposit end to end against a fake YooKassa API (tests/fake-yookassa.mjs).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');

const PORT='3519', base=`http://127.0.0.1:${PORT}/api`, ADMIN='live-money-admin-key-1234567890abcdef';
const uuid=()=>require('node:crypto').randomUUID();

test('live deposit: top-up, idempotency, webhook, edition, money condition, refund and operator desk', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'disbit-live-'));
  const file=path.join(dir,'test.db'), stateFile=path.join(dir,'yookassa.json');
  const seed=new DatabaseSync(file);
  seed.exec(fs.readFileSync(path.join(__dirname,'../backend/db/schema.sql'),'utf8'));
  const {LEGAL_VERSIONS}=await import('../backend/lib/legal.js');
  for (const [id,login] of [[1,'payer'],[2,'old_edition'],[3,'stranger']]) {
    seed.prepare("INSERT INTO users(id,login,email,pass_hash,pass_salt) VALUES(?,?,?,'x','x')").run(id,login,`${login}@example.org`);
    seed.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(String(id).repeat(64),id,Date.now()+3600000);
  }
  for (const [document,version] of Object.entries(LEGAL_VERSIONS)) {
    seed.prepare("INSERT INTO legal_acceptances(user_id,document,version,source,accepted_at) VALUES(1,?,?,'email',?)").run(document,version,Date.now());
    seed.prepare("INSERT INTO legal_acceptances(user_id,document,version,source,accepted_at) VALUES(2,?,'2026-11-01','email',?)").run(document,Date.now());
  }
  seed.prepare(`INSERT INTO habits(id,user_id,name,schedule,stake_mode,stake_amount,stake_recipient,created_day)
    VALUES ('money-habit',1,'Бег','[0,1,2,3,4,5,6]','money',50,'creators','2026-11-01'),
           ('charity-habit',1,'Чтение','[0,1,2,3,4,5,6]','money',50,'charity','2026-11-01')`).run();
  seed.close();

  const env={...process.env,APP_ENV:'development',NODE_ENV:'test',PORT,HOST:'127.0.0.1',DB_PATH:file,PROOFS_DIR:path.join(dir,'proofs'),
    PAYMENTS_PROVIDER:'yookassa',YOOKASSA_SHOP_ID:'1527679',YOOKASSA_SECRET_KEY:'test_'+'k'.repeat(40),
    PUBLIC_URL:'https://disbit.test/',ADMIN_KEY:ADMIN,FAKE_YOOKASSA_STATE:stateFile,
    NODE_OPTIONS:[process.env.NODE_OPTIONS,'--import='+require('node:url').pathToFileURL(path.join(__dirname,'fake-yookassa.mjs')).href].filter(Boolean).join(' ')};
  const child=spawn(process.execPath,['backend/server.js'],{cwd:path.join(__dirname,'..'),env,stdio:['ignore','pipe','pipe']});
  let logs='';child.stderr.on('data',d=>{logs+=d;});
  const call=(route,body,user=1,method=body?'POST':'GET',headers={})=>fetch(base+route,{method,
    headers:{'Content-Type':'application/json',...(user?{Authorization:'Bearer '+String(user).repeat(64)}:{}),...headers},
    body:body?JSON.stringify(body):undefined}).then(async r=>({status:r.status,body:await r.json().catch(()=>null)}));
  const bank=()=>JSON.parse(fs.readFileSync(stateFile,'utf8'));
  const setBank=change=>{const s=bank();change(s);fs.writeFileSync(stateFile,JSON.stringify(s));};
  try {
    await new Promise((resolve,reject)=>{
      const t=setTimeout(()=>reject(Error('startup timed out\n'+logs)),15000);
      child.stdout.on('data',d=>{if(String(d).includes('localhost:'+PORT)){clearTimeout(t);resolve();}});
      child.once('exit',code=>{clearTimeout(t);reject(Error('exited '+code+'\n'+logs));});
    });
    assert.equal((await call('/health',null,0)).body.capabilities.livePayments,true);

    let wallet=(await call('/wallet')).body;
    assert.equal(wallet.payments.live,true);assert.equal(wallet.payments.simulated,false);
    assert.equal(wallet.balance,0);assert.equal(wallet.legal.current,true);assert.deepEqual(wallet.history,[]);

    // A process/network failure before the provider reply leaves a created intent.
    // Refresh must recover that SAME intent, rather than locking the deposit UI.
    const recoveryDb=new DatabaseSync(file);
    const {openMoneyPayment}=await import('../backend/lib/money-core.js');
    const interrupted=openMoneyPayment(recoveryDb,{userId:3,amount:10000});
    recoveryDb.close();
    const recovered=(await call('/wallet',null,3)).body.pending;
    assert.equal(recovered.id,interrupted.id);
    assert.equal(recovered.status,'pending');
    assert.match(recovered.url,/^https:\/\//);
    setBank(s=>{for(const p of Object.values(s.payments)) p.status='canceled';});
    await call(`/wallet/topup/${interrupted.id}`,null,3);
    setBank(s=>{s.payments={};});

    // Fee on top: 1000 ₽ to the deposit, 1038 ₽ to pay.
    const requestId=uuid();
    const started=await call('/wallet/topup',{amount:100000,requestId});
    assert.equal(started.status,200,JSON.stringify(started.body));
    assert.equal(started.body.id,requestId);assert.equal(started.body.status,'pending');
    assert.match(started.body.url,/^https:\/\/yoomoney\.ru\//);
    assert.equal(started.body.quote.total,103800);
    const providerId=started.body.providerId;
    assert.equal(bank().payments[providerId].amount.value,'1038.00');
    // A repeated request resumes the same payment; another one waits for it.
    assert.equal((await call('/wallet/topup',{amount:100000,requestId})).body.providerId,providerId);
    assert.equal(Object.keys(bank().payments).length,1);
    // Same amount again with a new request (back from the payment page): the open payment continues.
    assert.equal((await call('/wallet/topup',{amount:100000,requestId:uuid()})).body.providerId,providerId);
    assert.equal(Object.keys(bank().payments).length,1);
    // Another amount is a new payment, not an error.
    const second=await call('/wallet/topup',{amount:5000,requestId:uuid()});
    assert.equal(second.status,200);assert.notEqual(second.body.providerId,providerId);
    setBank(s=>{s.payments[second.body.providerId].status='canceled';});
    assert.equal((await call(`/wallet/topup/${second.body.id}`)).body.status,'canceled');
    assert.equal((await call('/wallet/topup',{amount:100000,requestId},3)).status,404);
    assert.equal((await call(`/wallet/topup/${requestId}`,null,3)).status,404);

    // A webhook body is never trusted: unknown and still-pending IDs credit nothing.
    assert.equal((await call('/wallet/webhook',{type:'notification',event:'payment.succeeded',object:{id:uuid()}},0)).status,200);
    assert.equal((await call('/wallet/webhook',{type:'notification',event:'payment.succeeded',object:{id:providerId}},0)).status,200);
    assert.equal((await call('/wallet')).body.balance,0);
    setBank(s=>{Object.assign(s.payments[providerId],{status:'succeeded',paid:true});});
    assert.equal((await call('/wallet/webhook',{type:'notification',event:'payment.succeeded',object:{id:providerId}},0)).status,200);
    assert.equal((await call('/wallet/webhook',{type:'notification',event:'payment.succeeded',object:{id:providerId}},0)).status,200);
    wallet=(await call('/wallet')).body;
    assert.equal(wallet.balance,100000);assert.equal(wallet.pending,null);
    assert.deepEqual(wallet.history.map(op=>op.status).sort(),['canceled','succeeded']);
    const paid=wallet.history.find(op=>op.status==='succeeded');
    assert.deepEqual([paid.type,paid.amount,paid.meta.fee],['topup',100000,3800]);
    assert.equal((await call(`/wallet/topup/${requestId}`)).body.status,'succeeded');

    // The deposit limit counts the confirmed balance.
    const limited=await call('/wallet/topup',{amount:1000000,requestId:uuid()},1);
    assert.equal(limited.status,200);
    setBank(s=>{for(const p of Object.values(s.payments)) Object.assign(p,{status:'canceled',paid:false});});
    setBank(s=>{Object.values(s.payments)[0].status='succeeded';Object.values(s.payments)[0].paid=true;});
    assert.equal((await call(`/wallet/topup/${limited.body.id}`)).body.status,'canceled');

    // An account on an older edition accepts the current one first.
    const outdated=await call('/wallet/topup',{amount:10000,requestId:uuid()},2);
    assert.equal(outdated.status,409);assert.equal(outdated.body.code,'legal_outdated');
    assert.equal((await call('/account/legal',{acceptTerms:true},2)).status,400);
    assert.equal((await call('/account/legal',{acceptTerms:true,acceptPersonalData:true},2)).body.current,true);
    assert.equal((await call('/wallet/topup',{amount:10000,requestId:uuid()},2)).status,200);

    // Money condition: explicit, for a promise to the creators only, fixed afterwards.
    assert.equal((await call('/wallet/terms',{habitId:'money-habit'})).status,400);
    assert.equal((await call('/wallet/terms',{habitId:'charity-habit',accept:true})).status,422);
    assert.equal((await call('/wallet/terms',{habitId:'money-habit',accept:true},3)).status,409);
    assert.equal((await call('/wallet/terms',{habitId:'money-habit',accept:true,acceptTerms:true,acceptPersonalData:true},3)).status,422);
    const terms=await call('/wallet/terms',{habitId:'money-habit',accept:true});
    assert.equal(terms.status,200);assert.equal(terms.body.amount,5000);assert.match(terms.body.effectiveDay,/^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual((await call('/wallet')).body.terms.map(t=>[t.habitId,t.amount]),[['money-habit',5000]]);
    const habit=(await call('/habits')).body.find(h=>h.id==='money-habit');
    assert.equal((await call('/habits/money-habit',{...habit,stake:{...habit.stake,amount:500}},1,'PUT')).status,409);
    assert.equal((await call('/habits/money-habit',null,1,'DELETE')).status,409);

    // Refund of the free balance goes back to the original payment, once.
    const refundId=uuid();
    assert.equal((await call('/wallet/refund',{amount:200000,requestId:uuid()})).status,400);
    const refund=await call('/wallet/refund',{amount:30000,requestId:refundId});
    assert.equal(refund.status,200,JSON.stringify(refund.body));assert.equal(refund.body.status,'succeeded');
    assert.equal((await call('/wallet/refund',{amount:30000,requestId:refundId})).body.duplicate,true);
    assert.equal((await call('/wallet/refund',{amount:30000,requestId:refundId},3)).status,404);
    assert.equal(Object.keys(bank().refunds).length,1);
    assert.equal(Object.values(bank().refunds)[0].amount.value,'300.00');
    wallet=(await call('/wallet')).body;
    assert.equal(wallet.balance,70000);
    assert.deepEqual(wallet.history.map(op=>op.type).sort(),['refund','topup','topup','topup']);
    const page=(await call('/wallet/history?offset=0')).body;
    assert.equal(page.history.length,4);assert.equal(page.hasMore,false);

    // Operator desk: receipts for «Мой налог», admin key only.
    assert.equal((await call('/moderation/money/admin')).status,401);
    const desk=(await call('/moderation/money/admin',null,0,'GET',{'X-Admin-Key':ADMIN})).body;
    assert.equal(desk.payments.length,1);assert.equal(desk.payments[0].total,103800);assert.equal(desk.payments[0].receipt_at,null);
    assert.equal(desk.refunds.length,1);
    assert.equal((await call('/moderation/money/receipt',{kind:'payment',id:desk.payments[0].id},0,'POST',{'X-Admin-Key':ADMIN})).status,200);
    assert.equal((await call('/moderation/money/receipt',{kind:'payment',id:desk.payments[0].id},0,'POST',{'X-Admin-Key':ADMIN})).status,409);

    // Forged webhooks and the secret never reach the logs.
    assert(!logs.includes('k'.repeat(40)),'secret key leaked to logs');
  } finally {
    if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
  }
});

test('hosted live payments need a live key and an HTTPS origin', async () => {
  const {validateRuntime}=await import('../backend/lib/runtime.js');
  const env={NODE_ENV:'production',APP_ENV:'production',DB_PATH:path.resolve('/data/p.db'),PROOFS_DIR:path.resolve('/data/proofs'),
    PUBLIC_URL:'https://disbit.ru',RELEASE_SHA:'7cfcc70',ADMIN_KEY:'x'.repeat(32),PAYMENTS_PROVIDER:'yookassa',
    YOOKASSA_SHOP_ID:'1527679',YOOKASSA_SECRET_KEY:'live_'+'a'.repeat(40)};
  assert.equal(validateRuntime(env).provider,'yookassa');
  for (const bad of [{YOOKASSA_SECRET_KEY:'test_'+'a'.repeat(40)},{YOOKASSA_SECRET_KEY:''},{YOOKASSA_SHOP_ID:'shop'},{YOOKASSA_TEST_ENABLED:'1'}])
    assert.throws(()=>validateRuntime({...env,...bad}));
});
