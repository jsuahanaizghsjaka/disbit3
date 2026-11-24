const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
test('retention only removes expired recognized backups inside its root',async()=>{
 const {expireBackups}=await import('../scripts/backup-retention.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'disbit-retention-'));
 for(const name of ['disbit-2026-09-01_0115.tar.gz','disbit-2026-11-13_0115.tar.gz','unrelated.txt'])fs.writeFileSync(path.join(root,name),'fixture');
 const now=Date.parse('2026-11-14T00:00:00Z');
 assert.equal(expireBackups(root,{now}).expired.length,1);
 assert.equal(fs.readdirSync(root).length,3);
 assert.equal(expireBackups(root,{now,apply:true}).expired.length,1);
 assert.deepEqual(fs.readdirSync(root).sort(),['disbit-2026-11-13_0115.tar.gz','unrelated.txt']);
});
