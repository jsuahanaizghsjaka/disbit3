import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const frontend=new URL('../../frontend/',import.meta.url);
const hashes=[];
for(const file of readdirSync(frontend).filter(f=>f.endsWith('.html'))){
  for(const match of readFileSync(new URL(file,frontend),'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){
    // Browsers hash the parsed text, where CRLF is already LF (HTML spec, input stream preprocessing).
    if(match[1].trim())hashes.push("'sha256-"+createHash('sha256').update(match[1].replace(/\r\n?/g,'\n')).digest('base64')+"'");
  }
}
/* Мини-приложение Telegram (/tg/): SDK с telegram.org и встраивание во фрейм Telegram Web.
   Остальной сайт по-прежнему запрещает фреймы целиком (ТЗ Telegram, раздел 9). */
const TELEGRAM_FRAME_ANCESTORS="https://web.telegram.org https://webk.telegram.org https://webz.telegram.org https://telegram.org";
export const isTelegramPath=p=>p==='/tg'||p.startsWith('/tg/');
export function securityHeaders(req,res,next){
 res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','strict-origin-when-cross-origin');
 if(isTelegramPath(req.path)){
  res.set('Content-Security-Policy',`default-src 'self'; script-src 'self' https://telegram.org; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://t.me; media-src 'self' blob:; font-src 'self'; connect-src 'self' https://disbit.ru; object-src 'none'; base-uri 'self'; frame-ancestors ${TELEGRAM_FRAME_ANCESTORS}; form-action 'self'`);
  return next();
 }
 res.set('X-Frame-Options','DENY');
 res.set('Content-Security-Policy',`default-src 'self'; script-src 'self' ${hashes.join(' ')}; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self' https://disbit.ru; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`);
 next();
}
const origins=new Set(['https://disbit.ru','https://staging.disbit.ru','capacitor://localhost','http://localhost','https://localhost',process.env.PUBLIC_URL]);
export function corsOrigin(origin,callback){
 const local=process.env.APP_ENV!=='production'&&process.env.APP_ENV!=='staging'&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin||'');
 callback(null,!origin||origins.has(origin)||local);
}
