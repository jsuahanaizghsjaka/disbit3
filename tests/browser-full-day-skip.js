// All requests target the disposable localhost fixture and its test account.
async page => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3399/');
  await page.evaluate(()=>{localStorage.setItem('disbit_token_v1','a'.repeat(64));localStorage.setItem('disbit_intro_v1','1')});
  await page.reload();
  await page.waitForFunction(()=>authUser?.login==='tester'&&!supportSyncBusy);
  const result=await page.evaluate(async()=>{
    const ids=['synthetic-day-a','synthetic-day-b'];
    for(const id of ids) {
      const created=await apiCallStrict('POST','/habits',{id,name:id,createdAt:TODAY,schedule:[0,1,2,3,4,5,6],goal:{type:'check'}});
      if(created.error) throw Error(created.error);
    }
    const list=await apiCallStrict('GET','/habits?includeArchived=1');
    habits=list; habits.forEach(migrate); hstatId=ids[0];
    const previous=confirmAction; confirmAction=async()=>true;
    try {await skipHabitDay(ids[0]);} finally {confirmAction=previous;}
    const marks=ids.map(id=>habits.find(h=>h.id===id)?.history[TODAY]);
    const quota=await apiCallStrict('GET','/habits/skips/quota');
    const reloaded=await apiCallStrict('GET','/habits?includeArchived=1');
    return {marks,used:quota.used,reloaded:ids.map(id=>reloaded.find(h=>h.id===id)?.history[TODAY])};
  });
  if(result.used!==1||result.marks.some(x=>x!=='skip')||result.reloaded.some(x=>x!=='skip')||errors.length) throw Error(JSON.stringify({result,errors}));
  return {ok:true,...result};
}
