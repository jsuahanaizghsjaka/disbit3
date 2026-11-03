import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, statfsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function monitorIssues({checks, disk, units, mailFailures}, previous = {}) {
  const issues = [];
  for (const [name, ok] of Object.entries(checks)) if (!ok) issues.push(`unavailable:${name}`);
  if (disk.percent >= 90 || disk.available < 1024 ** 3) issues.push('disk:low');
  for (const [name, unit] of Object.entries(units)) {
    if (unit.active !== 'active') issues.push(`service:${name}`);
    if (previous.units?.[name] && (unit.restarts > previous.units[name].restarts || unit.started !== previous.units[name].started)) issues.push(`restart:${name}`);
  }
  if (mailFailures > 0) issues.push('mail:delivery-failed');
  return issues.sort();
}

export async function runMonitor({stateDir = '/var/lib/disbit-monitor', selfTest = false} = {}) {
  mkdirSync(stateDir, {recursive:true, mode:0o700});
  const stateFile = path.join(stateDir, 'state.json');
  let previous = {};
  try { previous = JSON.parse(readFileSync(stateFile, 'utf8')); } catch {}
  const now = Date.now();
  const checks = {};
  await Promise.all(Object.entries({local:'http://127.0.0.1:3000/api/ready', https:'https://disbit.ru/api/ready'}).map(async ([name,url]) => {
    try {const response=await fetch(url,{signal:AbortSignal.timeout(10000)});checks[name]=response.ok && (await response.json()).ok===true;}
    catch {checks[name]=false;}
  }));
  const diskInfo=statfsSync('/srv/disbit/data');
  const disk={available:diskInfo.bavail*diskInfo.bsize,percent:Math.round(100*(1-diskInfo.bfree/diskInfo.blocks))};
  const units={};
  for(const name of ['disbit','caddy']) {
    try {
      const text=execFileSync('systemctl',['show',name,'--property=ActiveState,NRestarts,ExecMainStartTimestampMonotonic'],{encoding:'utf8',timeout:10000});
      const fields=Object.fromEntries(text.trim().split('\n').map(line=>line.split('=')));
      units[name]={active:fields.ActiveState,restarts:Number(fields.NRestarts),started:fields.ExecMainStartTimestampMonotonic};
    } catch {units[name]={active:'unknown',restarts:0,started:''};}
  }
  let mailFailures=0;
  try {
    const since=new Date(previous.checkedAt || now-5*60000).toISOString();
    const journal=execFileSync('journalctl',['-u','disbit','--since',since,'--until',new Date(now).toISOString(),'--no-pager','-o','cat'],{encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024});
    mailFailures=journal.split('\n').filter(line=>line.includes('[mail]') && /failed|не удалось|resend:/.test(line)).length;
  } catch {checks.journal=false;}
  const issues=monitorIssues({checks,disk,units,mailFailures},previous);
  const changed=JSON.stringify(issues)!==JSON.stringify(previous.issues || []);
  const notify=selfTest || changed || (issues.length>0 && now-(previous.lastAlertAt || 0)>=3600000);
  let lastAlertAt=previous.lastAlertAt || 0;
  if(notify) {
    const {sendMail,isEmailFormatValid}=await import('../backend/lib/email.js');
    const recipient=process.env.MONITOR_EMAIL;
    if(!isEmailFormatValid(recipient || '')) throw Error('Monitoring recipient is not configured');
    const status=selfTest?'Тест уведомления':issues.length?'Требуется проверка':'Работа восстановлена';
    const result=await sendMail(recipient,`Disbit: ${status}`,
      `<h2>${status}</h2><p>${new Date(now).toISOString()}</p><p>${issues.join(', ') || 'Проверки доступности и служб прошли.'}</p><p>Диск: ${disk.percent}%, свободно ${Math.floor(disk.available/1024**2)} МБ.</p><p>Инструкция: ops/PASSWORD-RELEASE.md. Пароли, коды и данные пользователей в уведомления не включаются.</p>`);
    if(!result.sent) throw Error('Monitoring notification was not sent');
    lastAlertAt=now;
  }
  const state={checkedAt:now,lastAlertAt,checks,disk,units,mailFailures,issues};
  writeFileSync(stateFile+'.tmp',JSON.stringify(state,null,2),{mode:0o600});
  renameSync(stateFile+'.tmp',stateFile);
  console.log(JSON.stringify({ok:issues.length===0,issues,notificationSent:notify,disk}));
  return state;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  runMonitor({selfTest:process.argv.includes('--self-test')}).catch(()=>{
    console.error('[monitor] check or notification failed; inspect configuration and service status');process.exitCode=1;
  });
}
