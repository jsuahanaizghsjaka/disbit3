// Run against the isolated sandbox fixture with playwright-cli run-code.
async page => {
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:3399/');
  await page.evaluate(()=>{
    localStorage.setItem('disbit_token_v1','a'.repeat(64));
    localStorage.setItem('disbit_intro_v1','1');
  });
  await page.reload();
  await page.waitForFunction(()=>authUser?.login==='tester'&&!supportSyncBusy);
  const result=await page.evaluate(()=>{
    const counts={stats:0,calendar:0,profile:0};
    const oldStats=renderStats, oldCalendar=renderCalendar, oldProfile=renderProfile;
    renderStats=(...a)=>{counts.stats++;return oldStats(...a);};
    renderCalendar=(...a)=>{counts.calendar++;return oldCalendar(...a);};
    renderProfile=(...a)=>{counts.profile++;return oldProfile(...a);};
    switchScreen('today',false);
    counts.stats=counts.calendar=counts.profile=0;
    const habit={id:'test-visible',name:'Проверка рендера',icon:'svg:i-h-book',color:'#4E78FF',
      createdAt:TODAY,schedule:[0,1,2,3,4,5,6],history:{},counts:{},
      goal:{type:'check'},stake:{mode:'money',amount:100},min:'',weekTarget:0};
    habits=[habit]; render();
    const hiddenCalls={...counts};
    const todayBefore=document.querySelector('#habit-list').textContent.includes('Проверка рендера');
    switchScreen('stats',false);
    const statsAfter=counts.stats>0 && document.querySelector('#streak-list').textContent.includes('Проверка рендера');
    switchScreen('calendar',false);
    const calendarAfter=counts.calendar>0 && document.querySelector('#cal-grid').children.length>0;
    habit.name='Обновлённое обещание'; render();
    switchScreen('today',false);
    const todayAfter=document.querySelector('#habit-list').textContent.includes('Обновлённое обещание');
    switchScreen('profile',false);
    const profileAfter=counts.profile>0;
    return {hiddenCalls,todayBefore,statsAfter,calendarAfter,todayAfter,profileAfter};
  });
  if(Object.values(result.hiddenCalls).some(Boolean)||!result.todayBefore||!result.statsAfter||!result.calendarAfter||!result.todayAfter||!result.profileAfter||errors.length) {
    throw Error(JSON.stringify({result,errors}));
  }
  return {ok:true,...result};
}
