// Isolated :3337 fixture only. A tab left open past midnight must move to the new day by itself.
async page => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  await page.goto('http://localhost:3337');
  await page.evaluate(()=>{
    localStorage.clear(); localStorage.setItem('disbit_intro_v1','1');
    localStorage.setItem('disbit_token_v1','1'.repeat(64)); localStorage.setItem('disbit_owner_v1','beta_tester');
    localStorage.setItem('disbit_auth_user_v1',JSON.stringify({id:1,login:'beta_tester',emailVerified:true}));
  });
  await page.reload(); await page.waitForFunction(()=>myLogin==='beta_tester'&&habits.length>=3);
  const tomorrow=()=>page.evaluate(()=>{
    window.__sameDocument=true;
    const Real=Date, shift=86400000;
    window.Date=class extends Real { constructor(...args){ if(args.length) super(...args); else super(Real.now()+shift); } static now(){ return Real.now()+shift; } };
  });
  const returnToTab=()=>page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));

  // Same day: returning to the tab must not reload.
  await page.evaluate(()=>{window.__sameDocument=true;}); await returnToTab(); await page.waitForTimeout(300);
  assert(await page.evaluate(()=>window.__sameDocument===true),'Reloaded without a day change');

  // New day with an open sheet: the form is not interrupted.
  await tomorrow();
  await page.evaluate(()=>openSheet('add-overlay')); await returnToTab(); await page.waitForTimeout(300);
  assert(await page.evaluate(()=>window.__sameDocument===true),'Open sheet was interrupted by reload');
  assert(await page.evaluate(()=>reloadIfDayChanged()===false),'Reload not deferred while a sheet is open');

  // Sheet closed: the next return to the tab reloads into the new day.
  await page.evaluate(()=>closeSheet('add-overlay'));
  await Promise.all([page.waitForEvent('load'), returnToTab()]);
  await page.waitForFunction(()=>typeof myLogin==='string'&&myLogin==='beta_tester');
  assert(await page.evaluate(()=>window.__sameDocument===undefined&&TODAY===dateKey()),'Page did not reload into the current day');
  assert(errors.length===0,`Browser errors: ${errors.join(', ')}`);
  return {sameDay:'kept',openSheet:'deferred',newDay:'reloaded',errors:errors.length};
}
