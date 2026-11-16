import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const frontend=new URL('../../frontend/',import.meta.url);
const hashes=[];
for(const file of readdirSync(frontend).filter(f=>f.endsWith('.html'))){
  for(const match of readFileSync(new URL(file,frontend),'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){
    if(match[1].trim())hashes.push("'sha256-"+createHash('sha256').update(match[1]).digest('base64')+"'");
  }
}
export function securityHeaders(req,res,next){
 res.set('X-Content-Type-Options','nosniff');res.set('X-Frame-Options','DENY');res.set('Referrer-Policy','strict-origin-when-cross-origin');
 res.set('Content-Security-Policy',`default-src 'self'; script-src 'self' ${hashes.join(' ')}; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self' https://disbit.ru; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`);
 next();
}
const origins=new Set(['https://disbit.ru','https://staging.disbit.ru','capacitor://localhost','http://localhost','https://localhost',process.env.PUBLIC_URL]);
export function corsOrigin(origin,callback){
 const local=process.env.APP_ENV!=='production'&&process.env.APP_ENV!=='staging'&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin||'');
 callback(null,!origin||origins.has(origin)||local);
}
