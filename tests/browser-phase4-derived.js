async page => {
 await page.goto('http://127.0.0.1:3399');
 return await page.evaluate(()=>{
  authToken=null;document.querySelectorAll('.sheet-overlay,.intro').forEach(x=>x.hidden=true);
  document.querySelector('.app').inert=false;
  const a={id:'cache-a',name:'A',createdAt:dateKey(addDays(new Date(),-30)),schedule:[0,1,2,3,4,5,6],history:{},counts:{},goal:{type:'check'},stake:{mode:'money',amount:0},min:'',weekTarget:0};
  const b={...a,id:'cache-b',name:'B',history:{}};habits=[a,b];goals=[];
  const assert=(v,m)=>{if(!v)throw Error(m);};
  for(const change of [()=>{},()=>a.history[TODAY]=true,()=>a.history[dateKey(addDays(new Date(),-1))]='min',()=>a.schedule=[0],()=>{a.goal={type:'count',target:2};a.counts[TODAY]=2;},()=>a.weekTarget=3]){
   change();assert(computeStreak(a)===calculateStreak(a),'current cache');assert(computeBestStreak(a)===calculateBestStreak(a),'best cache');
  }
  a.schedule=[0,1,2,3,4,5,6];a.weekTarget=0;
  const route={id:'route',habitIds:[a.id],startedAt:'2000-01-01',steps:30};
  for(const change of [()=>{},()=>a.counts[TODAY]=0,()=>a.history[TODAY]='min',()=>route.startedAt='2999-01-01',()=>route.habitIds=[b.id]]){
   change();assert(stepsDone(route)===calculateStepsDone(route),'marathon cache stale');
  }
  switchScreen('today',false);render();
  const before=document.querySelector('[data-hid="cache-b"]');
  const focus=before.querySelector('[data-stats]');focus.focus();render();
  assert(document.querySelector('[data-hid="cache-b"]')===before,'unchanged node replaced');assert(document.activeElement===focus,'focus lost');
  a.name='Changed';render();assert(document.querySelector('[data-hid="cache-b"]')===before,'unrelated card replaced');
  assert(document.querySelector('[data-hid="cache-a"]').textContent.includes('Changed'),'changed card stale');
  let clicks=0;const old=toggleHabit;toggleHabit=()=>clicks++;
  render();render();before.querySelector('[data-check]').click();toggleHabit=old;
  assert(clicks===1,'duplicate handlers');
  return {ok:true,cacheInvalidation:true,stableNode:true,focusPreserved:true,singleHandler:true};
 });
}
