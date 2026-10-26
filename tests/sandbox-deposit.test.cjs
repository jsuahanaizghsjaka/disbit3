const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

let sandbox;
async function fixture() {
  sandbox ||= await import('../backend/lib/sandbox-deposit.js');
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(),'disbit-sandbox-')),'db.sqlite'));
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync(join(__dirname,'../backend/db/schema.sql'),'utf8'));
  db.exec(`INSERT INTO users(id,login,email,pass_hash,pass_salt) VALUES
    (1,'tester','tester@example.invalid','hash','salt'),
    (2,'other','other@example.invalid','hash','salt');
    INSERT INTO wallets(user_id,balance) VALUES (1,999900);
    INSERT INTO money_accounts(user_id,balance) VALUES (1,500000);`);
  return db;
}
function payment(intent, shopId='1234567') {
  return { id:'23d93cac-000f-5000-8000-126628f15141', test:true,
    status:'pending',paid:false,amount:{value:(intent.amount/100).toFixed(2),currency:'RUB'},
    metadata:{disbit_intent:intent.id},recipient:{account_id:shopId},
    confirmation:{confirmation_url:'https://yoomoney.ru/test-payment'} };
}

test('test-shop configuration requires test key and HTTPS origin; all registered accounts can use it', async () => {
  const config={YOOKASSA_TEST_ENABLED:'1',YOOKASSA_TEST_SHOP_ID:'1234567',
    YOOKASSA_TEST_SECRET_KEY:'test_'+'x'.repeat(30),PUBLIC_URL:'https://disbit.ru/'};
  sandbox ||= await import('../backend/lib/sandbox-deposit.js');
  assert.equal(sandbox.sandboxConfig({}).enabled,false);
  assert.throws(()=>sandbox.sandboxConfig({...config,YOOKASSA_TEST_SECRET_KEY:'live_'+'x'.repeat(30)}),/Test-shop/);
  assert.throws(()=>sandbox.sandboxConfig({...config,PUBLIC_URL:'http://disbit.ru/'}),/HTTPS/);
  assert.throws(()=>sandbox.sandboxConfig({...config,PUBLIC_URL:'https://user:pass@disbit.ru/'}),/HTTPS/);
  const db=await fixture();
  try {
    const c=sandbox.sandboxConfig(config);
    assert.equal(sandbox.sandboxAllowed(db,1,c),true);
    assert.equal(sandbox.sandboxAllowed(db,2,c),true);
    assert.equal(sandbox.sandboxAllowed(db,999,c),false);
    assert.equal(sandbox.sandboxAllowed(db,1,sandbox.sandboxConfig({})),false);
  } finally { db.close(); }
});

test('test deposit history pages through every operation without mixing accounts', async () => {
  const db=await fixture();
  try {
    const insert=db.prepare('INSERT INTO sandbox_payment_intents(id,user_id,request_id,amount,idempotency_key) VALUES (?,?,?,?,?)');
    for(let i=0;i<35;i++) {
      const id=randomUUID();
      insert.run(id,1,randomUUID(),5000,`history-${id}`);
    }
    const other=randomUUID();
    insert.run(other,2,randomUUID(),5000,`history-${other}`);
    const first=sandbox.sandboxHistory(db,1,30,0);
    const second=sandbox.sandboxHistory(db,1,30,30);
    assert.equal(sandbox.sandboxSnapshot(db,1).history.length,30);
    assert.equal(first.length,30);
    assert.equal(second.length,5);
    assert.equal(new Set([...first,...second].map(row=>row.id)).size,35);
    assert.equal(sandbox.sandboxHistory(db,2,30,0).length,1);
    assert.ok(![...first,...second].some(row=>row.id===other));
  } finally { db.close(); }
});

test('verified test payment credits only sandbox once; forged webhook and live object cannot credit', async () => {
  const db=await fixture();
  try {
    let remote;
    let reads=0, creates=0;
    const provider={
      async createPayment(intent) { creates++;remote=payment(intent);return remote; },
      async getPayment() { reads++;return remote; }
    };
    const service=sandbox.createSandboxService(db,provider,'1234567');
    const requestId=randomUUID();
    const started=await service.start(1,30000,requestId,'https://disbit.ru/?sandbox_paid=1');
    assert.equal(started.status,'pending'); assert.match(started.url,/^https:\/\//);
    assert.equal(sandbox.sandboxSnapshot(db,1).balance,0);
    assert.equal((await service.start(1,30000,requestId,'https://disbit.ru/')).id,started.id);
    assert.equal(creates,1);
    await service.notification({type:'notification',event:'payment.succeeded',object:{id:remote.id,status:'succeeded'}});
    assert.equal(sandbox.sandboxSnapshot(db,1).balance,0);
    remote={...remote,status:'succeeded',paid:true};
    assert.equal((await service.notification({type:'notification',event:'payment.succeeded',object:{id:remote.id}})).status,'succeeded');
    assert.equal((await service.notification({type:'notification',event:'payment.succeeded',object:{id:remote.id}})).duplicate,true);
    assert.equal(reads,4);
    assert.equal(sandbox.sandboxSnapshot(db,1).balance,30000);
    assert.equal(sandbox.sandboxSnapshot(db,1).history[0].balance_after,30000);
    assert.equal(db.prepare('SELECT balance FROM wallets WHERE user_id=1').get().balance,999900);
    assert.equal(db.prepare('SELECT balance FROM money_accounts WHERE user_id=1').get().balance,500000);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sandbox_ledger').get().n,1);
    assert.equal(await service.status(2,started.id),null);
    assert.throws(()=>sandbox.openSandboxIntent(db,{userId:1,amount:10000,requestId}),/another amount/);
    const second=sandbox.openSandboxIntent(db,{userId:1,amount:10000,requestId:randomUUID()});
    assert.throws(()=>sandbox.attachSandboxPayment(db,second.id,{...payment(second),test:false},'1234567'),/match/);
    assert.throws(()=>sandbox.attachSandboxPayment(db,second.id,payment(second,'another-shop'),'1234567'),/match/);
    assert.throws(()=>sandbox.attachSandboxPayment(db,second.id,{...payment(second),confirmation:{confirmation_url:'http://example.invalid/pay'}},'1234567'),/confirmation URL/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sandbox_ledger').get().n,1);
  } finally { db.close(); }
});
