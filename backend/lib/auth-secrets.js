import {createHash,createHmac,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,chmodSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=path.dirname(process.env.DB_PATH||fileURLToPath(new URL('../db/disbit.db',import.meta.url)));
mkdirSync(directory,{recursive:true,mode:0o700});
const keyFile=path.join(directory,'.email-code-key');
try{writeFileSync(keyFile,randomBytes(32),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
if(process.platform!=='win32')chmodSync(keyFile,0o600);
const key=readFileSync(keyFile);
if(key.length!==32)throw Error('Invalid email code key');
export const sessionDigest=token=>'sha256:'+createHash('sha256').update(token).digest('hex');
export const emailCodeDigest=(userId,code)=>createHmac('sha256',key).update(userId+':'+code).digest('hex');
