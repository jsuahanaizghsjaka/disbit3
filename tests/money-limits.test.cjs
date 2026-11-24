// Offer limits: 1–10 000 ₽ per top-up, deposit ≤ 100 000 ₽, 2.8 % + 1 % on top, fees not refunded.
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {spawn}=require('node:child_process');
const {readFileSync,mkdtempSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const servers=[];
after(()=>{for(const child of servers)child.kill();});

test('quote adds 2.8 % and 1 % on top, rounded up to a kopeck; limits match the offer',async()=>{
 const m=await import('../backend/lib/money-limits.js');
 assert.deepEqual(m.topupQuote(100000),{amount:100000,paymentFee:2800,serviceFee:1000,fee:3800,total:103800});
 assert.deepEqual(m.topupQuote(100),{amount:100,paymentFee:3,serviceFee:1,fee:4,total:104});
 assert.equal(m.topupQuote(1000000).total,1038000);
 for(const bad of [99,0,-100,1000001,10.5,NaN,'500',null])assert.equal(m.topupProblem(bad)?.code,'amount_range',String(bad));
 assert.equal(m.topupProblem(100),null);assert.equal(m.topupProblem(1000000),null);
 assert.equal(m.topupProblem(1000000,9000000),null);
 const over=m.topupProblem(20000,9990000);assert.equal(over.code,'balance_limit');assert.equal(over.left,10000);assert.match(over.error,/ещё на 100 ₽/);
 assert.equal(m.topupProblem(10000,9980000,15000).code,'balance_limit','pending top-ups count toward the cap');
});

test('real payment intent carries the fee, credits only the deposit and refunds never return the fee',async()=>{
 const core=await import('../backend/lib/money-core.js');
 const db=new DatabaseSync(join(mkdtempSync(join(tmpdir(),'disbit-limits-')),'db.sqlite'));
 db.exec('PRAGMA foreign_keys=ON');db.exec(readFileSync(join(__dirname,'../backend/db/schema.sql'),'utf8'));
 db.exec("INSERT INTO users(id,login,email,pass_hash,pass_salt) VALUES(1,'payer','payer@example.invalid','h','s')");
 const provider=(intent,value,id='payment-12345678901234567890')=>({id,amount:{value,currency:'RUB'},metadata:{disbit_intent:intent.id},status:'succeeded',paid:true,test:false,confirmation:{confirmation_url:'https://yookassa.ru/c'}});
 assert.throws(()=>core.openMoneyPayment(db,{userId:1,amount:99}),/от 1 до 10 000/);
 assert.throws(()=>core.openMoneyPayment(db,{userId:1,amount:1000001}),/от 1 до 10 000/);
 const intent=core.openMoneyPayment(db,{userId:1,amount:100000});
 assert.equal(intent.fee,3800);
 assert.throws(()=>core.attachProviderPayment(db,intent.id,provider(intent,'1000.00')),/match/,'a payment without the fee is not ours');
 core.attachProviderPayment(db,intent.id,provider(intent,'1038.00'));
 assert.deepEqual(core.confirmProviderPayment(db,provider(intent,'1038.00')),{credited:true,balance:100000});
 assert.throws(()=>core.reserveMoneyRefund(db,{userId:1,amount:100001}),/Insufficient/);
 const refund=core.reserveMoneyRefund(db,{userId:1,amount:100000});
 assert.equal(refund.parts.reduce((s,p)=>s+p.amount,0),100000);
 // cap: 100 000 ₽ including pending intents
 db.prepare('UPDATE money_accounts SET balance=9950000,reserved=0 WHERE user_id=1').run();
 core.openMoneyPayment(db,{userId:1,amount:40000});
 assert.throws(()=>core.openMoneyPayment(db,{userId:1,amount:20000}),/100 000 ₽/);
 core.openMoneyPayment(db,{userId:1,amount:10000});
 db.close();
});

test('top-up route enforces the range and the deposit cap and returns the quote',async()=>{
 const port=3513;
 const child=spawn(process.execPath,[join(__dirname,'fixture-server.mjs')],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
 servers.push(child);
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('fixture timeout')),15000);child.stdout.on('data',b=>{if(String(b).includes(':'+port)){clearTimeout(t);resolve();}});child.on('exit',c=>reject(Error('exit '+c)));});
 const topup=amount=>fetch(`http://127.0.0.1:${port}/api/wallet/topup`,{method:'POST',headers:{Authorization:'Bearer '+'1'.repeat(64),'Content-Type':'application/json'},body:JSON.stringify({amount})}).then(async r=>({status:r.status,body:await r.json()}));
 for(const bad of [99,1000001,'1000',150.5])assert.equal((await topup(bad)).status,400,String(bad));
 const one=await topup(100);assert.equal(one.status,200);assert.equal(one.body.quote.total,104);
 const wallet=await fetch(`http://127.0.0.1:${port}/api/wallet`,{headers:{Authorization:'Bearer '+'1'.repeat(64)}}).then(r=>r.json());
 assert.deepEqual(wallet.limits,{topupMin:100,topupMax:1000000,balanceMax:10000000,feePercent:3.8});
 let balance=wallet.balance;
 while(balance+1000000<=10000000){assert.equal((await topup(1000000)).status,200);balance+=1000000;}
 const over=await topup(1000000);assert.equal(over.status,400);assert.equal(over.body.code,'balance_limit');
});
