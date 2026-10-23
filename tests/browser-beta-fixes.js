// Run only against the isolated fixture-server, via playwright-cli run-code.
async page => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  await page.goto('http://127.0.0.1:3337');
  await page.evaluate(()=>{
    localStorage.clear();localStorage.setItem('disbit_intro_v1','1');
    localStorage.setItem('disbit_token_v1','1'.repeat(64));localStorage.setItem('disbit_owner_v1','beta_tester');
    localStorage.setItem('disbit_auth_user_v1',JSON.stringify({id:1,login:'beta_tester',emailVerified:true}));
  });
  await page.reload();await page.waitForFunction(()=>myLogin==='beta_tester'&&habits.length>=3);
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>openAddSheet());
  assert(await page.locator('#f-min').isVisible(),'Minimum hidden');
  assert(await page.locator('#recipient .active').getAttribute('data-rec')==='creators','Default recipient');
  await page.locator('#f-name').fill('Тихая прогулка');
  await page.locator('#f-min').fill('Выйти на пять минут');
  await page.locator('#btn-save').scrollIntoViewIfNeeded();
  const widths=await page.locator('#add-overlay .sheet-actions').evaluate(el=>[...el.querySelectorAll('button')].map(b=>b.getBoundingClientRect().width));
  assert(widths.every(w=>w>100),'Action buttons squeezed');
  assert(await page.locator('#add-overlay .hold-help').evaluate(el=>el.getBoundingClientRect().width)<=1,'Visible hold instructions');
  await page.screenshot({path:'test-results/beta-form-mobile.png',fullPage:true});
  await page.locator('#btn-save').click();assert(await page.locator('#add-overlay').isVisible(),'Short click submitted');
  await page.locator('#btn-save').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>habits.some(h=>h.name==='Тихая прогулка'));
  for(const [name,id] of [['Пустынный путь','beta-check'],['Водный маршрут','beta-count']]) {
    await page.locator('#dock [data-screen="marathon"]').click();
    await page.locator('#btn-goal-add').click();await page.locator('#g-name').fill(name);
    assert(!(await page.locator('#g-deadline').isVisible())&&!(await page.locator('#g-steps').isVisible()),'Regular inputs visible');
    await page.locator('#g-steps-wheel').click();
    await page.getByRole('spinbutton',{name:'Шаги',exact:true}).press('ArrowDown');
    await page.locator('[data-wheel-cancel]').click();assert(await page.locator('#g-steps').inputValue()==='30','Cancel changed steps');
    await page.locator('#g-steps-wheel').click();
    await page.getByRole('spinbutton',{name:'Шаги',exact:true}).press('ArrowDown');
    await page.locator('[data-wheel-apply]').click();assert(await page.locator('#g-steps-wheel').textContent()==='31 шагов','Wheel label stale');
    await page.locator('#g-deadline-wheel').click();await page.locator('[data-wheel-apply]').click();
    await page.locator('#g-deadline-wheel').click();await page.locator('[data-wheel-clear]').click();
    assert(await page.locator('#g-deadline').inputValue()==='','Clear deadline');
    await page.locator(`.mh-check[value="${id}"]`).check();await page.locator('#g-save').click();
    await page.locator('#goal-overlay').waitFor({state:'hidden'});
  }
  await page.locator('#dock [data-screen="today"]').click();
  assert(await page.locator('#walker .walker-card').count()===2,'Second marathon missing from Today');
  assert(await page.locator('#walker .w-goal').allTextContents().then(a=>a.includes('Водный маршрут')),'Second name missing');
  await page.screenshot({path:'test-results/beta-marathons-mobile.png',fullPage:true});
  await page.locator('#dock [data-screen="marathon"]').click();await page.locator('#open-avatar').click();
  const cap=page.locator('#gear-picker [data-gear="cap"]');
  await cap.click();assert(await page.locator('.traveler-cap').count()>0,'Cap drawing missing');
  await page.locator('#dock [data-screen="today"]').click();
  const yesterday=await page.evaluate(()=>dateKey(addDays(new Date(),-1)));
  await page.evaluate(day=>openDaySheet(day),yesterday);
  assert(await page.locator('#day-body [data-dtoggle], #day-body [data-step], #day-body [data-dmin]').count()===0,'Past controls exposed');
  await page.evaluate(()=>closeSheet('day-overlay'));
  await page.locator('[data-check="beta-check"]').click();
  await page.locator('#completion-dialog').waitFor({state:'visible'});
  assert(await page.locator('#completion-skip').textContent()==='Пропустить · осталось 5 из 5','Initial quota');
  await page.keyboard.press('Escape');
  assert(await page.evaluate(()=>!isDoneToday(habits.find(h=>h.id==='beta-check'))),'Escape counted completion');
  await page.locator('[data-check="beta-check"]').click();await page.locator('#completion-skip').click();
  await page.waitForFunction(()=>isDoneToday(habits.find(h=>h.id==='beta-check')));
  assert(await page.evaluate(async()=> (await apiCallStrict('GET','/proofs/quota')).remaining)===4,'Skip quota');
  await page.reload();await page.waitForFunction(()=>habits.some(h=>h.id==='beta-check')&&myLogin==='beta_tester');
  assert(await page.evaluate(()=>isDoneToday(habits.find(h=>h.id==='beta-check'))),'Completion lost on reload');
  assert(await page.evaluate(()=>habits.find(h=>h.name==='Тихая прогулка').min==='Выйти на пять минут'),'Minimum description lost on reload');
  assert(await page.locator('#walker .walker-card').count()===2,'Routes lost on reload');
  // Counter stays incomplete before its target; proof is requested only at the target.
  await page.locator('[data-check="beta-count"]').click();
  await page.waitForFunction(()=>habits.find(h=>h.id==='beta-count').counts[TODAY]===1);
  await page.locator('[data-check="beta-count"]').click();await page.locator('#completion-dialog').waitFor({state:'visible'});
  await page.locator('#completion-dialog [value="share"]').click();
  await page.locator('#proof-close').click();
  assert(await page.evaluate(()=>!isDoneToday(habits.find(h=>h.id==='beta-count'))),'Closing capture counted completion');
  // Exhaust quota using isolated test records; browser must disable skip, not only show a warning.
  await page.evaluate(async()=>{
    for(let i=0;i<4;i++) {
      await apiCallStrict('POST','/habits',{id:'browser-quota-'+i,name:'Quota test'});
      await apiCallStrict('POST','/proofs/skip',{habitId:'browser-quota-'+i,day:TODAY});
    }
  });
  await page.locator('[data-check="beta-count"]').click();
  await page.locator('#completion-dialog').waitFor({state:'visible'});
  assert(await page.locator('#completion-skip').isDisabled(),'Exhausted quota enabled');
  await page.screenshot({path:'test-results/beta-proof-mobile.png',fullPage:true});
  await page.locator('#completion-dialog [value="share"]').click();
  assert(await page.locator('#proof-skip').isDisabled(),'Capture quota bypass');
  // Camera hardware is not available in CI: inject a valid small PNG into the captured-media stage.
  await page.evaluate(()=>{
    const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
    proofBlob=new Blob([bytes],{type:'image/png'});proofShowPreview(URL.createObjectURL(proofBlob),'photo');
  });
  await page.locator('#proof-send').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>isDoneToday(habits.find(h=>h.id==='beta-count')));
  for(const width of [320,390,1280]) {
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow '+width);
  }
  await page.screenshot({path:'test-results/beta-dashboard-desktop.png',fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce',colorScheme:'light'});
  await page.evaluate(()=>openAddSheet());
  assert(await page.locator('#f-min').isVisible(),'Reduced motion form');
  await page.evaluate(()=>closeSheet('add-overlay'));
  assert(!errors.length,'Browser errors: '+errors.join('; '));
  return {passed:true,checks:20,errors};
}
