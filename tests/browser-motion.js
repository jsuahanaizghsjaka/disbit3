// Isolated test fixture only. Run with playwright-cli --filename; no production writes.
async page => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const assert=(value,message)=>{if(!value)throw Error(message);};
  await page.goto('http://localhost:3337');
  await page.evaluate(()=>{
    localStorage.clear(); localStorage.setItem('disbit_intro_v1','1');
    localStorage.setItem('disbit_token_v1','1'.repeat(64)); localStorage.setItem('disbit_owner_v1','beta_tester');
    localStorage.setItem('disbit_auth_user_v1',JSON.stringify({id:1,login:'beta_tester',emailVerified:true}));
  });
  await page.reload(); await page.waitForFunction(()=>myLogin==='beta_tester'&&habits.length>=3);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#dock [data-screen="profile"]').click();
  assert(await page.locator('#wallet-card').isVisible(),'Deposit must be visible');
  assert(await page.evaluate(()=>document.querySelector('.profile-hero').nextElementSibling.id==='profile-money'),'Deposit is not after profile');
  assert(await page.locator('#wallet-card').evaluate(el=>!el.closest('details')),'Deposit nested in disclosure');
  await page.screenshot({path:'test-results/motion-profile-mobile.png',fullPage:true});
  await page.locator('#profile-settings > summary').click();
  await page.getByRole('button',{name:'Оформление и движение',exact:true}).click();
  assert(await page.locator('#set-motion').isVisible(),'Stack content missing');
  await page.locator('#set-motion').selectOption('reduce');
  assert(await page.evaluate(()=>motionReduced()),'User reduced motion not respected');
  await page.locator('#set-motion').selectOption('system');
  await page.locator('.stack-back').click();
  await page.getByRole('button',{name:'Напоминания',exact:true}).click();
  assert(await page.locator('#notif-browser').isVisible(),'Browser notification explanation lost');
  await page.locator('#profile-settings > summary').click();
  // Face is draft until saved; cancel does not mutate profile.
  const original=await page.evaluate(()=>profile.mark);
  await page.locator('#btn-profile-edit').click();
  await page.locator('[data-face]').nth(2).click();
  assert(await page.locator('#ava-preview .face-avatar').count()===1,'Face did not preview');
  await page.locator('#pf-cancel').click();
  assert(await page.evaluate(()=>profile.mark)===original,'Cancel persisted avatar');
  await page.locator('#btn-profile-edit').click();
  await page.locator('[data-face]').nth(3).click(); await page.locator('#pf-save').click();
  assert(await page.locator('#profile-avatar .face-avatar').count()===1,'Face not saved');
  await page.reload(); await page.waitForFunction(()=>profile.mark?.startsWith('face:'));
  // Wheel keyboard, draft cancellation, month bounds, and apply.
  await page.locator('#dock [data-screen="marathon"]').click(); await page.locator('#btn-goal-add').click();
  await page.locator('#g-steps').fill('30'); await page.locator('#g-steps + .wheel-open').click();
  await page.getByRole('spinbutton',{name:'Дни',exact:true}).press('ArrowDown');
  await page.locator('[data-wheel-cancel]').click(); assert(await page.locator('#g-steps').inputValue()==='30','Wheel cancel mutated input');
  await page.locator('#g-steps + .wheel-open').click();
  await page.getByRole('spinbutton',{name:'Дни',exact:true}).press('ArrowDown');
  await page.locator('[data-wheel-apply]').click(); assert(await page.locator('#g-steps').inputValue()==='31','Wheel did not apply');
  await page.locator('#g-deadline').fill('2028-01-31'); await page.locator('#g-deadline + .wheel-open').click();
  await page.getByRole('spinbutton',{name:'Месяц',exact:true}).press('ArrowDown');
  await page.locator('[data-wheel-apply]').click(); assert(await page.locator('#g-deadline').inputValue()==='2028-02-29','Leap year bounds failed');
  await page.locator('#g-cancel').click();
  // Destructive hold: brief click and interrupted hold must not confirm.
  await page.evaluate(()=>{window.motionConfirm=null;confirmAction('Удалить тест?','Это проверка интерфейса','Удалить').then(v=>window.motionConfirm=v);});
  const confirm=page.locator('#confirm-dialog [value="confirm"]');
  await confirm.click(); assert(await page.locator('#confirm-dialog').evaluate(el=>el.open),'Short press confirmed');
  const rect=await confirm.boundingBox(); await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2); await page.mouse.down();
  await page.waitForTimeout(200); await page.mouse.move(0,0); await page.mouse.up();
  await page.waitForTimeout(1100); assert(await page.evaluate(()=>window.motionConfirm===null),'Cancelled hold fired late');
  await confirm.focus(); await page.keyboard.down('Space'); await page.waitForTimeout(1100); await page.keyboard.up('Space');
  await page.waitForFunction(()=>window.motionConfirm===true);
  // Archive undo and successful commit, history preserved after server reload.
  const history=await page.evaluate(()=>JSON.stringify(habits.find(h=>h.id==='beta-check').history));
  await page.evaluate(()=>queueHabitArchive(habits.find(h=>h.id==='beta-check')));
  await page.locator('.archive-undo button').click(); assert(await page.evaluate(()=>pendingArchive===null&&!habits.find(h=>h.id==='beta-check').archived),'Undo failed');
  await page.evaluate(()=>queueHabitArchive(habits.find(h=>h.id==='beta-check')));
  await page.mouse.move(0,0); await page.waitForFunction(()=>habits.find(h=>h.id==='beta-check').archived,{},{timeout:12000});
  assert(await page.evaluate(()=>JSON.stringify(habits.find(h=>h.id==='beta-check').history))===history,'Archive lost history');
  await page.reload(); await page.waitForFunction(()=>habits.find(h=>h.id==='beta-check')?.archived);
  await page.locator('#dock [data-screen="today"]').click();
  assert(await page.locator('[data-check="beta-check"]').count()===0,'Archived habit remains active');
  await page.locator('#dock [data-screen="profile"]').click(); await page.locator('#profile-archive > summary').click();
  await page.getByRole('button',{name:'Восстановить: Читать каждый день'}).click();
  await page.waitForFunction(()=>!habits.find(h=>h.id==='beta-check').archived);
  // Failed archive request must not hide a habit or claim success.
  await page.route('**/api/habits/beta-check/archive',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"Тест: нет связи"}'}));
  await page.evaluate(()=>setHabitArchived('beta-check',true));
  assert(await page.evaluate(()=>!habits.find(h=>h.id==='beta-check').archived),'Failed archive hid habit');
  await page.unroute('**/api/habits/beta-check/archive');
  // Light has an accessible alternative and no effect on theme.
  const theme=await page.evaluate(()=>settings.theme);
  await page.locator('.profile-cord button').click();
  assert(await page.locator('.profile-cord button').getAttribute('aria-checked')==='true','Cord light did not toggle');
  assert(await page.evaluate(()=>settings.theme)===theme,'Decoration changed app theme');
  for(const width of [320,390,430,1440]) {
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow '+width);
  }
  await page.emulateMedia({reducedMotion:'reduce'}); assert(await page.evaluate(()=>motionReduced()),'System reduced motion ignored');
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:'test-results/motion-profile-desktop.png',fullPage:true});
  await page.emulateMedia({reducedMotion:'no-preference'});
  assert(errors.length===0,'Browser errors: '+errors.join('; '));
  return {ok:true,errors,checks:'deposit, settings stack, avatar cancel/save/reload, bounded wheels, cancelled hold, keyboard hold, archive undo/commit/restore/network failure, cord, mobile/desktop overflow, reduced motion'};
}
