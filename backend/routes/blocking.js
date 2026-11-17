import {Router} from 'express';
import {db,rowToHabit} from '../db/db.js';
import {buildBlockingPlan} from '../lib/blocking-plan.js';
import {requestLimit} from '../lib/request-limits.js';
import {BLOCKING_CONSENT_VERSION,PLAN_LEASE_MS,PLAN_REFRESH_MS,enforcementEnabled,enrollDevice,resolveDevice,
  dropOrphanDevices,publicDevice,allowedPackages,planVersion,recordReceipt} from '../lib/blocking-devices.js';
const router=Router();
router.use((req,res,next)=>{
 res.set('Cache-Control','no-store');
 if(!req.userId)return res.status(401).json({error:'Нужен аккаунт'});
 next();
});
const deviceIdOf=req=>typeof req.query.deviceId==='string'?req.query.deviceId:req.headers['x-disbit-device'];

router.get('/plan',(req,res)=>{
 const user=db.prepare('SELECT time_zone FROM users WHERE id=?').get(req.userId);
 if(!user)return res.status(401).json({error:'Нужен аккаунт'});
 const rows=db.prepare("SELECT * FROM habits WHERE user_id=? AND stake_mode='lock'").all(req.userId);
 const habits=rows.map(row=>rowToHabit(row,db.prepare('SELECT * FROM completions WHERE habit_id=?').all(row.id)));
 const skippedDays=db.prepare('SELECT day FROM promise_full_day_skips WHERE user_id=?').all(req.userId).map(row=>row.day);
 const plan=buildBlockingPlan({habits,skippedDays,timeZone:user.time_zone||'Europe/Moscow'});
 const preview=enrollment=>res.json({enabled:false,mode:'preview',enrollment,consentVersion:BLOCKING_CONSENT_VERSION,serverNow:plan.serverNow,timeZone:plan.timeZone,active:false,windows:[],preview:plan});
 // Without the switch nothing is enforced anywhere: the calculation stays a preview.
 if(!enforcementEnabled())return preview('disabled');
 const found=resolveDevice({userId:req.userId,sessionHash:req.token,deviceId:deviceIdOf(req)});
 if(found.state!=='ok')return preview(found.state);
 const byId=new Map(habits.map(h=>[h.id,h]));
 // A promise with no restrictable app cannot restrict anything; it is reported, not enforced.
 const windows=[],unenforceable=[];
 for(const window of plan.windows){
  const habit=byId.get(window.habitId),apps=allowedPackages(habit?.stake?.apps);
  if(apps.length)windows.push({...window,name:habit.name,apps});else unenforceable.push(window.habitId);
 }
 const enforced={today:plan.today,windows};
 const version=planVersion(enforced);
 // The phone may keep restricting only until validUntil without asking again,
 // and never past the end of the account day the server confirmed.
 const validUntil=windows.length?Math.min(plan.endsAt,plan.serverNow+PLAN_LEASE_MS):plan.serverNow+PLAN_LEASE_MS;
 db.prepare('UPDATE blocking_devices SET last_seen_at=?,last_plan_version=? WHERE id=?').run(plan.serverNow,version,found.device.id);
 res.json({enabled:true,mode:'enforced',enrollment:'ok',deviceId:found.device.id,consentVersion:BLOCKING_CONSENT_VERSION,
  serverNow:plan.serverNow,timeZone:plan.timeZone,today:plan.today,active:windows.length>0,windows,
  apps:[...new Set(windows.flatMap(w=>w.apps))],unenforceable,planVersion:version,validUntil,refreshAfter:plan.serverNow+PLAN_REFRESH_MS});
});

router.get('/devices',(req,res)=>{
 dropOrphanDevices();
 res.json({consentVersion:BLOCKING_CONSENT_VERSION,enforcement:enforcementEnabled(),
  devices:db.prepare('SELECT * FROM blocking_devices WHERE user_id=? ORDER BY created_at').all(req.userId).map(row=>publicDevice(row,req.token))});
});

router.post('/devices',requestLimit('blocking-enroll',20,60*60000,req=>req.userId),(req,res)=>{
 const result=enrollDevice({userId:req.userId,sessionHash:req.token,body:req.body});
 res.status(result.status).json(result.body);
});

router.delete('/devices/:id',(req,res)=>{
 const removed=db.prepare('DELETE FROM blocking_devices WHERE id=? AND user_id=?').run(String(req.params.id),req.userId);
 if(!removed.changes)return res.status(404).json({error:'Устройство не найдено'});
 res.json({ok:true});
});

router.post('/devices/:id/receipts',requestLimit('blocking-receipt',240,60*60000,req=>req.userId),(req,res)=>{
 const found=resolveDevice({userId:req.userId,sessionHash:req.token,deviceId:String(req.params.id)});
 if(found.state!=='ok')return res.status(found.state==='enrollment_required'?404:409).json({error:'Устройство не подключено',code:found.state});
 if(!recordReceipt({device:found.device,body:req.body}))return res.status(400).json({error:'Некорректное подтверждение'});
 res.status(201).json({ok:true});
});

router.get('/devices/:id/receipts',(req,res)=>{
 const device=db.prepare('SELECT id FROM blocking_devices WHERE id=? AND user_id=?').get(String(req.params.id),req.userId);
 if(!device)return res.status(404).json({error:'Устройство не найдено'});
 res.json({items:db.prepare('SELECT plan_version AS planVersion,state,habit_ids,created_at AS createdAt FROM blocking_receipts WHERE device_id=? ORDER BY id DESC LIMIT 50').all(device.id)
  .map(({habit_ids,...row})=>({...row,habitIds:JSON.parse(habit_ids)}))});
});
export default router;
