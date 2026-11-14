import {Router} from 'express';
import {db,rowToHabit} from '../db/db.js';
import {buildBlockingPlan} from '../lib/blocking-plan.js';
const router=Router();
router.get('/plan',(req,res)=>{
 res.set('Cache-Control','no-store');
 if(!req.userId)return res.status(401).json({error:'Нужен аккаунт'});
 const user=db.prepare('SELECT time_zone FROM users WHERE id=?').get(req.userId);
 if(!user)return res.status(401).json({error:'Нужен аккаунт'});
 const rows=db.prepare("SELECT * FROM habits WHERE user_id=? AND stake_mode='lock'").all(req.userId);
 const habits=rows.map(row=>rowToHabit(row,db.prepare('SELECT * FROM completions WHERE habit_id=?').all(row.id)));
 const skippedDays=db.prepare('SELECT day FROM promise_full_day_skips WHERE user_id=?').all(req.userId).map(row=>row.day);
 const plan=buildBlockingPlan({habits,skippedDays,timeZone:user.time_zone||'Europe/Moscow'});
 // Preview only until native enrollment, account binding and device acceptance exist.
 res.json({enabled:false,mode:'preview',serverNow:plan.serverNow,timeZone:plan.timeZone,active:false,windows:[],preview:plan});
});
export default router;
