// Audit harness: isolated localhost fixture only; never use against production.
async page => {
  const origin='http://127.0.0.1:3399';
  await page.goto(origin);
  await page.evaluate(()=>{
    localStorage.setItem('disbit_token_v1','a'.repeat(64));
    localStorage.setItem('disbit_intro_v1','1');
    localStorage.setItem('disbit_owner_v1','tester');
  });
  await page.waitForFunction(()=>typeof supportSyncBusy==='boolean'&&!supportSyncBusy,{},{timeout:15000});
  // Allow the existing 800ms state debounce to drain before timing a reload.
  await page.waitForTimeout(1000);
  const requests=[];
  page.on('request',r=>{if(r.url().includes('/api/'))requests.push({path:'/api/'+r.url().split('/api/')[1].split('?')[0],method:r.method(),at:Date.now()});});
  await page.route('**/api/**',async route=>{await page.waitForTimeout(150);await route.continue();});
  const bootStarted=Date.now();
  await page.reload();
  await page.waitForFunction(()=>authUser?.login==='tester'&&wallet?.sandbox?.available&&!supportSyncBusy);
  const bootstrap={artificialDelayPerRequestMs:150,elapsedMs:Date.now()-bootStarted,requests:requests.map(r=>({...r,at:r.at-bootStarted}))};
  await page.unroute('**/api/**');
  const cdp=await page.context().newCDPSession(page);
  const scenarios=[];
  for(const cpuRate of [1,4]) {
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpuRate});
    for(const config of [{habits:5,days:90,goals:1},{habits:30,days:365,goals:6},{habits:100,days:1095,goals:20}]) {
      const result=await page.evaluate(config=>{
        authToken=null;
        const start=addDays(new Date(),-config.days), keys=Array.from({length:config.days},(_,i)=>dateKey(addDays(start,i)));
        habits=Array.from({length:config.habits},(_,i)=>({id:`audit-${i}`,name:`Обещание ${i+1}`,icon:'svg:i-h-book',color:'#4E78FF',createdAt:dateKey(start),schedule:[0,1,2,3,4,5,6],weekTarget:0,pinned:false,min:'Одна страница',bit:0,goal:{type:'check'},stake:{mode:'money',amount:100,to:'creators'},counts:{},history:Object.fromEntries(keys.filter((_,j)=>(j+i)%10<7).map(k=>[k,true]))}));
        goals=Array.from({length:config.goals},(_,i)=>({id:`journey-${i}`,name:`Маршрут ${i+1}`,steps:100000,startedAt:dateKey(start),createdAt:dateKey(start),habitIds:habits.slice(i*5,i*5+5).map(h=>h.id),scene:SCENES[i%SCENES.length].id}));
        profile.activeGoal=goals[0]?.id; profile.photo=null;profile.gear='cap';profile.owned=[];
        ledger=[]; friends=[]; rewards=[];backlog=[];
        document.querySelectorAll('.sheet-overlay,.intro').forEach(x=>x.hidden=true);
        switchScreen('today',false); render();
        const names=['renderHabits','renderStats','renderProfile','renderCalendar','renderGoals','renderWalker','renderHeatmap','renderStatsText','formatDay','computeStreak','computeBestStreak','stepsDone'];
        const originals={},stats={};
        for(const name of names){originals[name]=window[name];stats[name]={calls:0,ms:0};window[name]=function(...args){const t=performance.now();try{return originals[name](...args);}finally{stats[name].calls++;stats[name].ms+=performance.now()-t;}};}
        const obs=new MutationObserver(()=>{});obs.observe(document.body,{subtree:true,childList:true});
        const samples=[];
        for(let run=0;run<3;run++) {const t=performance.now();render();const ms=performance.now()-t;const mutations=obs.takeRecords();samples.push({ms,addedNodes:mutations.reduce((s,m)=>s+m.addedNodes.length,0),removedNodes:mutations.reduce((s,m)=>s+m.removedNodes.length,0)});}
        obs.disconnect();for(const name of names)window[name]=originals[name];
        const nav={};
        for(const name of ['profile','marathon','today','avatar','profile']){const t=performance.now();switchScreen(name,false);nav[name]=(nav[name]||[]).concat(performance.now()-t);}
        const t=performance.now();JSON.stringify(habits);const stringifyMs=performance.now()-t;
        return {config,samples,inclusiveFunctionStats:stats,navigationSynchronousMs:nav,stringifyMs,serializedBytes:JSON.stringify(habits).length,domElements:document.querySelectorAll('*').length,svgElements:document.querySelectorAll('svg *').length};
      },config);
      scenarios.push({cpuRate,...result});
    }
  }
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  return {browser:await page.context().browser().version(),viewport:page.viewportSize(),bootstrap,scenarios,note:'Synthetic localhost data; CPU throttle is diagnostic, not a Galaxy A22 equivalence. Function stats inclusive; sync durations exclude paint/network.'};
}
