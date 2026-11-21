import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export function expireBackups(root,{apply=false,now=Date.now()}={}) {
 const base=fs.realpathSync(root), expired=[], skipped=[];
 for(const item of fs.readdirSync(base,{withFileTypes:true})) {
  if(item.isSymbolicLink()) {skipped.push(item.name);continue;}
  const candidate=path.join(base,item.name);
  let created;
  const manifest=path.join(candidate,'manifest.json');
  if(item.isDirectory()&&fs.existsSync(manifest)) {
   const data=JSON.parse(fs.readFileSync(manifest,'utf8'));
   if(data.format===1)created=Date.parse(data.createdAt);
  }
  if(!created) {
   const match=item.name.match(/(?:disbit-|pre-|restore|verified|backup|restored).*?(20\d{2})-?(\d{2})-?(\d{2})/);
   if(match) created=Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  }
  if(!Number.isFinite(created)){skipped.push(item.name);continue;}
  if(now-created < 30*86400000)continue;
  const resolved=fs.realpathSync(candidate);
  if(path.dirname(resolved)!==base)throw Error('Backup path escapes approved root');
  expired.push(item.name);
  if(apply)fs.rmSync(resolved,{recursive:item.isDirectory(),force:false});
 }
 return {root:base,apply,expired,skipped};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(fs.realpathSync(process.argv[1])).href){
 const [root,mode]=process.argv.slice(2);
 if(!root||!['--check','--apply'].includes(mode))throw Error('Usage: backup-retention.mjs APPROVED_BACKUP_ROOT --check|--apply');
 console.log(JSON.stringify(expireBackups(root,{apply:mode==='--apply'})));
}
