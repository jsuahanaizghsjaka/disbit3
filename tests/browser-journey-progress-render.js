// Synthetic in-memory data only; no production account or mutations.
async page => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3399/');
  const result=await page.evaluate(() => {
    habits=[{id:'synthetic-habit',name:'Тест',goal:{type:'check'},
      history:{'2026-01-01':true,'2026-01-02':'skip','2026-01-03':'min'},counts:{}}];
    goals=[
      {id:'finished',name:'Завершённый',steps:2,startedAt:'2026-01-01',habitIds:['synthetic-habit']},
      {id:'manual',name:'Ручной',progress:30},
      {id:'in-progress',name:'Текущий',steps:10,startedAt:'2026-01-01',habitIds:['synthetic-habit']}
    ];
    profile.activeGoal='in-progress';
    const reference=goals.map(g=>({id:g.id,pct:goalPct(g)})).sort((a,b)=>(a.pct>=100)-(b.pct>=100));
    const original=stepsDone; let calls=0;
    stepsDone=(...args)=>{calls++;return original(...args)};
    try {
      renderGoals();
      const rows=[...document.querySelectorAll('#goal-list .goal-row')];
      const actual=rows.map(row=>({id:row.querySelector('[data-gedit]').dataset.gedit,pct:Number(row.querySelector('.g-pct').textContent.replace('%',''))}));
      const firstCalls=calls;
      const selected=!!document.querySelector('#goal-list .selected-route [data-gselect="in-progress"][aria-pressed="true"]');
      habits[0].history['2026-01-04']=true;
      calls=0; renderGoals();
      const refreshed=document.querySelector('[data-gedit="in-progress"]').closest('.goal-row').querySelector('.g-pct').textContent==='30%';
      return {reference,actual,firstCalls,selected,refreshed,secondCalls:calls};
    } finally {stepsDone=original;}
  });
  if(JSON.stringify(result.reference)!==JSON.stringify(result.actual)||result.firstCalls!==2||result.secondCalls!==2||!result.selected||!result.refreshed||errors.length)
    throw Error(JSON.stringify({result,errors}));
  return {ok:true,...result};
}
