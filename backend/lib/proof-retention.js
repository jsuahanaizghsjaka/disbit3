import fs from 'node:fs';
import path from 'node:path';
// Mark first, then unlink. A crash between the steps is retried next sweep.
export function pruneProofMedia(db,directory){
 const columns=db.prepare('PRAGMA table_info(proofs)').all();
 if(!columns.some(c=>c.name==='media_deleted'))return 0;
 db.prepare("UPDATE proofs SET media_deleted=1 WHERE status IN ('approved','rejected') AND resolved_at<=datetime('now','-30 days')").run();
 let removed=0;
 for(const row of db.prepare('SELECT file FROM proofs WHERE media_deleted=1').all()){
  if(!row.file||path.basename(row.file)!==row.file||row.file.includes('\\'))throw Error('Unsafe proof path');
  const file=path.join(directory,row.file);
  try{fs.unlinkSync(file);removed++;}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 return removed;
}
