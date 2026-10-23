const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
let db,accountDay,proofQuota;
before(async()=>{
  process.env.DB_PATH=path.join(mkdtempSync(path.join(tmpdir(),'disbit-policy-')),'policy.db');
  ({db}=await import('../backend/db/db.js'));
  ({accountDay,proofQuota}=await import('../backend/proof-policy.js'));
  for(const id of [11,12]) db.prepare('INSERT INTO users(id,login,email,pass_hash,pass_salt) VALUES (?,?,?,?,?)').run(id,`policy_${id}`,`policy-${id}@example.invalid`,'no-login','no-login');
});
after(()=>db?.close());
test('account timezone locks once; UTC midnight is not account midnight',()=>{
  const req={userId:11,headers:{'x-time-zone':'Asia/Vladivostok'}};
  assert.equal(accountDay(req,new Date('2026-10-31T16:00:00Z')),'2026-11-01');
  req.headers['x-time-zone']='America/Los_Angeles';
  assert.equal(accountDay(req,new Date('2026-10-31T16:00:00Z')),'2026-11-01');
});
test('invalid timezone uses Moscow; month rollover resets allowance without deleting receipts',()=>{
  const req={userId:12,headers:{'x-time-zone':'not-a-zone'}};
  assert.equal(accountDay(req,new Date('2026-10-31T22:00:00Z')),'2026-11-01');
  for(let i=0;i<5;i++) db.prepare('INSERT INTO proof_skips VALUES(?,?,?,?)').run(12,'old-'+i,'2026-10-31','2026-10');
  assert.equal(proofQuota(12,'2026-10-31').remaining,0);
  assert.equal(proofQuota(12,'2026-11-01').remaining,5);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM proof_skips WHERE user_id=12').get().n,5);
});
