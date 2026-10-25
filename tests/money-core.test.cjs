const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');

let core, settlement;
const agreement={agreementVersion:'draft-qa',agreementHash:'a'.repeat(64)};
async function fixture() {
  core ||= await import('../backend/lib/money-core.js');
  settlement ||= await import('../backend/lib/money-settlement.js');
  const db=new DatabaseSync(join(mkdtempSync(join(tmpdir(),'disbit-money-')),'db.sqlite'));
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync(join(__dirname,'../backend/db/schema.sql'),'utf8'));
  db.exec('ALTER TABLE users ADD COLUMN time_zone TEXT');
  db.exec("ALTER TABLE habits ADD COLUMN archive_periods TEXT NOT NULL DEFAULT '[]'");
  db.exec(`INSERT INTO users(id,login,email,pass_hash,pass_salt,time_zone)
    VALUES(1,'payer','payer@example.invalid','hash','salt','Europe/Moscow');
    INSERT INTO wallets(user_id,balance) VALUES(1,99999999);
    INSERT INTO habits(id,user_id,name,schedule,stake_mode,stake_amount,stake_recipient,created_day)
    VALUES('habit-1',1,'Promise','[0,1,2,3,4,5,6]','money',20,'creators','2026-10-01')`);
  return db;
}
function payment(intent, id='payment-12345678901234567890') {
  return { id, amount:{value:(intent.amount/100).toFixed(2),currency:'RUB'},
    metadata:{disbit_intent:intent.id},status:'succeeded',paid:true,test:false,
    confirmation:{confirmation_url:'https://yookassa.ru/confirm/test'} };
}
function fund(db, amount, id) {
  const intent=core.openMoneyPayment(db,{userId:1,amount});
  const object=payment(intent,id);
  core.attachProviderPayment(db,intent.id,object);
  core.confirmProviderPayment(db,object);
  return {intent,object};
}

test('real wallet is isolated; verified payment credits once and mismatches never credit', async () => {
  const db=await fixture();
  try {
    assert.deepEqual(core.moneyBalance(db,1),{balance:0,reserved:0,available:0});
    const intent=core.openMoneyPayment(db,{userId:1,amount:10000});
    const object=payment(intent);
    assert.throws(()=>core.attachProviderPayment(db,intent.id,{...object,amount:{value:'101.00',currency:'RUB'}}),/match/);
    core.attachProviderPayment(db,intent.id,object);
    assert.throws(()=>core.confirmProviderPayment(db,{...object,metadata:{disbit_intent:'other'}}),/mismatch/);
    assert.throws(()=>core.confirmProviderPayment(db,{...object,test:true}),/mismatch/);
    assert.deepEqual(core.moneyBalance(db,1),{balance:0,reserved:0,available:0});
    assert.equal(core.confirmProviderPayment(db,object).credited,true);
    assert.equal(core.confirmProviderPayment(db,object).duplicate,true);
    assert.deepEqual(core.moneyBalance(db,1),{balance:10000,reserved:0,available:10000});
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM money_ledger WHERE type='topup'").get().n,1);
  } finally { db.close(); }
});

test('refund reserves only confirmed money, splits by original payment and releases failed part', async () => {
  const db=await fixture();
  try {
    assert.throws(()=>core.reserveMoneyRefund(db,{userId:1,amount:100}),/Insufficient/);
    const first=fund(db,7000,'payment-11111111111111111111');
    const second=fund(db,7000,'payment-22222222222222222222');
    const reserved=core.reserveMoneyRefund(db,{userId:1,amount:10000});
    assert.deepEqual(reserved.parts.map(x=>x.amount),[7000,3000]);
    const providerByIntent=new Map([[first.intent.id,first.object.id],[second.intent.id,second.object.id]]);
    assert.deepEqual(core.moneyBalance(db,1),{balance:14000,reserved:10000,available:4000});
    assert.throws(()=>core.reserveMoneyRefund(db,{userId:1,amount:5000}),/Insufficient/);
    const one={id:'refund-11111111111111111111',payment_id:providerByIntent.get(reserved.parts[0].paymentIntentId),amount:{value:'70.00',currency:'RUB'},status:'succeeded'};
    core.attachProviderRefund(db,reserved.parts[0].id,one);
    assert.equal(core.confirmProviderRefund(db,one).status,'partial');
    assert.equal(core.confirmProviderRefund(db,one).duplicate,true);
    const two={id:'refund-22222222222222222222',payment_id:providerByIntent.get(reserved.parts[1].paymentIntentId),amount:{value:'30.00',currency:'RUB'},status:'canceled'};
    core.attachProviderRefund(db,reserved.parts[1].id,two);
    assert.equal(core.confirmProviderRefund(db,two).status,'partial');
    assert.deepEqual(core.moneyBalance(db,1),{balance:7000,reserved:0,available:7000});
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM money_ledger WHERE type='refund'").get().n,1);
  } finally { db.close(); }
});

test('accepted terms start tomorrow; server settles closed days only, once, from available funds', async () => {
  const db=await fixture();
  try {
    fund(db,10000,'payment-33333333333333333333');
    assert.throws(()=>settlement.acceptMoneyTerms(db,{userId:1,habitId:'habit-1',now:new Date('2026-10-01T12:00:00Z')}),/agreement/);
    const accepted=settlement.acceptMoneyTerms(db,{userId:1,habitId:'habit-1',...agreement,now:new Date('2026-10-01T12:00:00Z')});
    assert.equal(accepted.effectiveDay,'2026-10-02');
    assert.equal(core.settleMoneyPenalty(db,{userId:1,habitId:'habit-1',day:'2026-10-01',today:'2026-10-03'}).reason,'no-accepted-terms');
    assert.throws(()=>core.settleMoneyPenalty(db,{userId:1,habitId:'habit-1',day:'2026-10-03',today:'2026-10-03'}),/closed/);
    const first=settlement.settleClosedMoneyDays(db,{now:new Date('2026-10-03T12:00:00Z')});
    assert.equal(first.length,1); assert.equal(first[0].status,'paid'); assert.equal(first[0].amount,2000);
    assert.deepEqual(core.moneyBalance(db,1),{balance:8000,reserved:0,available:8000});
    assert.deepEqual(settlement.settleClosedMoneyDays(db,{now:new Date('2026-10-03T12:00:00Z')}),[]);
    db.exec("INSERT INTO completions(habit_id,day,done) VALUES('habit-1','2026-10-03',1); INSERT INTO proof_skips(user_id,habit_id,day,month) VALUES(1,'habit-1','2026-10-03','2026-10')");
    assert.equal(settlement.settleClosedMoneyDays(db,{now:new Date('2026-10-04T12:00:00Z')})[0].reason,'completed-or-skipped');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM money_penalties').get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM money_ledger WHERE type='penalty'").get().n,1);
  } finally { db.close(); }
});

test('pending proof defers settlement; reserved refunds cannot finance penalties', async () => {
  const db=await fixture();
  try {
    fund(db,5000,'payment-44444444444444444444');
    settlement.acceptMoneyTerms(db,{userId:1,habitId:'habit-1',...agreement,now:new Date('2026-10-01T12:00:00Z')});
    core.reserveMoneyRefund(db,{userId:1,amount:4000});
    const pending=settlement.settleClosedMoneyDays(db,{now:new Date('2026-10-03T12:00:00Z')});
    assert.equal(pending[0].status,'insufficient');
    assert.equal(core.moneyBalance(db,1).balance,5000);
    db.exec("INSERT INTO proofs(user_id,habit_id,day,file,status) VALUES(1,'habit-1','2026-10-03','synthetic.png','pending')");
    const delayed=settlement.settleClosedMoneyDays(db,{now:new Date('2026-10-04T12:00:00Z')});
    assert.equal(delayed[0].reason,'proof-pending');
    assert.equal(db.prepare('SELECT last_day FROM money_settlement_cursors').get().last_day,'2026-10-02');
  } finally { db.close(); }
});

test('pending completion proof blocks debit; rejected proof does not count as completed', async () => {
  const db=await fixture();
  try {
    fund(db,10000,'payment-66666666666666666666');
    settlement.acceptMoneyTerms(db,{userId:1,habitId:'habit-1',...agreement,now:new Date('2026-10-01T12:00:00Z')});
    db.exec("INSERT INTO completions(habit_id,day,done) VALUES('habit-1','2026-10-02',1); INSERT INTO proofs(user_id,habit_id,day,file,status) VALUES(1,'habit-1','2026-10-02','synthetic.png','pending')");
    assert.equal(settlement.settleClosedMoneyDays(db,{now:new Date('2026-10-03T12:00:00Z')})[0].reason,'proof-pending');
    assert.equal(core.moneyBalance(db,1).balance,10000);
    db.exec("UPDATE proofs SET status='rejected' WHERE habit_id='habit-1'");
    assert.equal(settlement.settleClosedMoneyDays(db,{now:new Date('2026-10-03T12:00:00Z')})[0].status,'paid');
    assert.equal(core.moneyBalance(db,1).balance,8000);
  } finally { db.close(); }
});

test('weekly target starts next Monday and charges only when slack is exhausted', async () => {
  const db=await fixture();
  try {
    fund(db,10000,'payment-55555555555555555555');
    db.exec("UPDATE habits SET week_target=3 WHERE id='habit-1'");
    const accepted=settlement.acceptMoneyTerms(db,{userId:1,habitId:'habit-1',...agreement,now:new Date('2026-10-06T12:00:00Z')});
    assert.equal(accepted.effectiveDay,'2026-10-12');
    const early=settlement.settleClosedMoneyDays(db,{now:new Date('2026-10-16T12:00:00Z')});
    assert.equal(early.length,4);
    assert(early.every(x=>x.reason==='weekly-slack'));
    const friday=settlement.settleClosedMoneyDays(db,{now:new Date('2026-10-17T12:00:00Z')});
    assert.equal(friday[0].day,'2026-10-16'); assert.equal(friday[0].status,'paid');
    assert.equal(core.moneyBalance(db,1).balance,8000);
  } finally { db.close(); }
});

test('promise skip quota is server-owned: five free, three at 20 trusted bits, durable receipt', async () => {
  const { promiseSkipQuota, recordPromiseSkip, purchasePromiseSkip, transaction, syncTrustedBitAward } =
    await import('../backend/lib/promise-skips.js');
  const db=await fixture();
  try {
    const day='2026-10-02';
    for(let i=0;i<5;i++) transaction(db,()=>recordPromiseSkip(db,1,`h-${i}`,day));
    assert.equal(promiseSkipQuota(db,1,day).remaining,0);
    assert.equal(transaction(db,()=>recordPromiseSkip(db,1,'h-0',day)).remaining,0);
    assert.throws(()=>transaction(db,()=>recordPromiseSkip(db,1,'h-5',day)),/Лимит/);
    assert.throws(()=>purchasePromiseSkip(db,1,day,randomUUID()),/битов/);
    transaction(db,()=>{ for(let i=0;i<60;i++) syncTrustedBitAward(db,1,`earned-${i}`,day,true); });
    for(let i=0;i<3;i++) {
      const requestId=randomUUID();
      assert.equal(purchasePromiseSkip(db,1,day,requestId).bought,i+1);
      assert.equal(purchasePromiseSkip(db,1,day,requestId).duplicate,true);
    }
    assert.equal(promiseSkipQuota(db,1,day).trustedBits,0);
    assert.throws(()=>purchasePromiseSkip(db,1,day,randomUUID()),/трёх/);
    for(let i=5;i<8;i++) transaction(db,()=>recordPromiseSkip(db,1,`h-${i}`,day));
    assert.equal(promiseSkipQuota(db,1,day).remaining,0);
    assert.throws(()=>transaction(db,()=>recordPromiseSkip(db,1,'h-8',day)),/Лимит/);
    transaction(db,()=>syncTrustedBitAward(db,1,'earned-0',day,false));
    assert.equal(promiseSkipQuota(db,1,day).trustedBits,-1);
    assert.equal(promiseSkipQuota(db,1,'2026-11-01').remaining,5);
  } finally { db.close(); }
});

test('a forged skip mark without a quota receipt cannot waive a money penalty', async () => {
  const db=await fixture();
  try {
    fund(db,5000,'payment-77777777777777777777');
    settlement.acceptMoneyTerms(db,{userId:1,habitId:'habit-1',...agreement,now:new Date('2026-10-01T12:00:00Z')});
    db.exec("INSERT INTO completions(habit_id,day,skip) VALUES('habit-1','2026-10-02',1)");
    assert.equal(core.settleMoneyPenalty(db,{userId:1,habitId:'habit-1',day:'2026-10-02',today:'2026-10-03'}).status,'paid');
  } finally { db.close(); }
});

test('YooKassa adapter sends stable keys and reads original provider objects', async () => {
  const { createYooKassaClient }=await import('../backend/lib/yookassa-client.js');
  const calls=[];
  const client=createYooKassaClient({shopId:'shop',secretKey:'secret',request:async(url,opts)=>{
    calls.push({url,opts}); return {ok:true,json:async()=>({id:'provider-object'})};
  }});
  const intent={id:'intent-1',amount:12345,idempotencyKey:'topup-intent-1'};
  await client.createPayment(intent,'https://disbit.ru/?paid=1');
  assert.equal(calls[0].url,'https://api.yookassa.ru/v3/payments');
  assert.equal(calls[0].opts.headers['Idempotence-Key'],'topup-intent-1');
  assert.equal(JSON.parse(calls[0].opts.body).amount.value,'123.45');
  assert.equal(JSON.parse(calls[0].opts.body).metadata.disbit_intent,'intent-1');
  await client.getPayment('payment-12345678901234567890');
  assert.equal(calls[1].opts.method,'GET');
  await client.createRefund({amount:300,idempotencyKey:'refund-part-1'},'payment-12345678901234567890');
  assert.equal(JSON.parse(calls[2].opts.body).amount.value,'3.00');
  assert.equal(calls[2].opts.headers['Idempotence-Key'],'refund-part-1');
});

test('notification cannot credit its own forged body; service re-fetches and reconciles', async () => {
  const { createMoneyService }=await import('../backend/lib/money-service.js');
  const db=await fixture();
  try {
    let remote;
    let reads=0;
    const provider={
      async createPayment(intent) { remote={...payment(intent),status:'pending',paid:false}; return remote; },
      async getPayment() { reads++; return remote; },
      async createRefund() { throw Error('Provider temporarily unavailable'); },
      async getRefund() { throw Error('No refund'); }
    };
    const service=createMoneyService(db,provider);
    const started=await service.startPayment(1,10000,'https://disbit.ru/?paid=1');
    const fake={type:'notification',event:'payment.succeeded',object:{id:started.providerId,status:'succeeded',paid:true,amount:{value:'100.00',currency:'RUB'}}};
    assert.equal((await service.receiveNotification(fake)).pending,true);
    assert.equal(core.moneyBalance(db,1).balance,0);
    remote={...remote,status:'succeeded',paid:true};
    assert.equal((await service.receiveNotification(fake)).credited,true);
    assert.equal((await service.receiveNotification(fake)).duplicate,true);
    assert.equal(reads,3);
    const refund=await service.startRefund(1,3000);
    assert.equal(refund.results[0].pending,true);
    assert.deepEqual(core.moneyBalance(db,1),{balance:10000,reserved:3000,available:7000});
    assert.equal((await service.reconcile('https://disbit.ru/?paid=1'))[0].pending,true);
  } finally { db.close(); }
});
