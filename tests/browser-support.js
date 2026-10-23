// Visual sections 21–25. Only the disposable localhost:3337 fixture.
async page => {
  const assert=(value,message)=>{if(!value)throw Error(message);};
  const passed=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {
  await page.unrouteAll({behavior:'ignoreErrors'});
  await page.goto('http://localhost:3337');
  await page.evaluate(()=>{
    localStorage.setItem('disbit_intro_v1','1');
    localStorage.setItem('disbit_owner_v1','beta_tester');
    localStorage.setItem('disbit_token_v1','1'.repeat(64));
    localStorage.setItem('disbit_auth_user_v1',JSON.stringify({id:1,login:'beta_tester',emailVerified:true}));
    localStorage.removeItem('disbit_state_ts_v1');
  });
  await page.reload();await page.waitForFunction(()=>myLogin==='beta_tester'&&!supportSyncBusy&&wallet);
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{switchScreen('profile');document.getElementById('profile-settings').open=true;});
  await page.getByRole('button',{name:'Напоминания',exact:true}).click();
  assert(await page.locator('#notif-browser').isVisible(),'Browser must explain reminder availability');
  assert(await page.locator('#notif-block').isHidden(),'Browser showed native controls');
  passed.push('platform availability');
  await page.locator('.stack-back').click();await page.getByRole('button',{name:'Оформление и движение',exact:true}).click();
  await page.locator('#set-motion').selectOption('reduce');
  assert(await page.evaluate(()=>reducedMotion()&&document.documentElement.dataset.motion==='reduce'),'App reduction not applied');
  await page.reload();await page.waitForFunction(()=>!supportSyncBusy&&wallet);
  assert(await page.locator('#set-motion').inputValue()==='reduce','Motion preference lost');
  await page.evaluate(()=>document.getElementById('profile-settings').open=true);
  await page.getByRole('button',{name:'Оформление и движение',exact:true}).click();
  await page.locator('#set-motion').selectOption('system');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>document.documentElement.dataset.motion==='reduce');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(()=>document.documentElement.dataset.motion==='full');passed.push('persisted motion and system priority');
  await page.locator('.stack-back').click();await page.getByRole('button',{name:'Обещания и итог дня',exact:true}).click();
  await page.locator('#set-offday').click();const offday=await page.evaluate(()=>settings.showOffday);
  assert(await page.locator('#set-offday').getAttribute('aria-checked')===String(offday),'Offday switch mismatch');passed.push('offday setting');
  await page.locator('.stack-back').click();await page.getByRole('button',{name:'Блокировка приложений',exact:true}).click();
  await page.locator('#capability-open').click();
  assert(await page.locator('.capability-steps li').count()===5,'Missing native flow states');
  for(const state of ['permission','active','finished','revoked','choose']) {
    await page.locator(`[data-capability="${state}"]`).click();
    assert(await page.locator('#capability-state-action').isDisabled(),'Preview enabled a native action');
  }
  await page.screenshot({path:'test-results/support-capability.png',fullPage:true});
  await page.keyboard.press('Tab');
  assert(await page.evaluate(()=>document.getElementById('capability-overlay').contains(document.activeElement)),'Focus escaped sheet');
  await page.keyboard.press('Escape');await page.locator('#capability-overlay').waitFor({state:'hidden'});
  assert(await page.evaluate(()=>document.activeElement.id==='capability-open'),'Close lost trigger focus');passed.push('unavailable flow and keyboard');
  // Native adapter is mocked, no real device permissions or notifications are used.
  await page.locator('.stack-back').click();await page.getByRole('button',{name:'Напоминания',exact:true}).click();
  await page.evaluate(()=>{
    settings.notif={on:false,morning:'09:00',evening:'21:00',eveningOn:true};
    window.savedNotifPlugin=notifPlugin;window.permissionRequests=0;window.scheduledItems=[];
    window.mockNotif={checkPermissions:async()=>({display:'denied'}),requestPermissions:async()=>{permissionRequests++;return {display:'denied'};},getPending:async()=>({notifications:[]}),cancel:async()=>{},schedule:async({notifications})=>{scheduledItems=notifications;}};
    notifPlugin=()=>mockNotif;renderNotifSettings();
  });
  assert(await page.evaluate(()=>permissionRequests===0),'Permission requested without user action');
  await page.locator('#set-notif').click();
  await page.waitForFunction(()=>!notifBusy&&notifPermission==='denied');
  assert(await page.locator('#notif-help').isVisible(),'Permission denial has no help');
  assert(await page.locator('#set-notif').getAttribute('aria-checked')==='false','Denied permission enabled switch');
  await page.evaluate(()=>{mockNotif.checkPermissions=async()=>({display:'granted'});});
  await page.locator('#notif-help summary').click();
  await page.locator('#notif-check').click();await page.locator('#set-notif').click();
  await page.waitForFunction(()=>notifCfg().on&&!notifBusy);
  await page.locator('#set-notif-morning').fill('10:30');await page.locator('#set-notif-morning').dispatchEvent('change');
  assert(await page.evaluate(()=>notifCfg().morning==='10:30'),'Reminder time lost');
  await page.locator('#set-notif-evening-on').click();
  assert(await page.locator('#notif-evening-time').isHidden(),'Evening off still shows time');
  await page.evaluate(()=>{mockNotif.checkPermissions=async()=>({display:'denied'});return checkNotifPermission();});
  assert(await page.evaluate(()=>!notifCfg().on),'Revoked permission remained enabled');
  await page.evaluate(()=>{notifPlugin=savedNotifPlugin;clearTimeout(notifTimer);renderNotifSettings();});
  passed.push('notification denial, time, revoke');
  await page.evaluate(()=>{document.getElementById('profile-data').open=true;});
  const downloadPromise=page.waitForEvent('download');await page.locator('#btn-export').click();
  const download=await downloadPromise;await download.saveAs('test-results/support-export.json');
  assert(download.suggestedFilename().endsWith('.json'),'Export missing');passed.push('JSON download');
  await page.evaluate(()=>importData(new File(['{}'],'backup.json',{type:'application/json'})));
  assert((await page.locator('#data-status').textContent()).includes('серверный аккаунт пока недоступен'),'Cloud import must not silently replace account');passed.push('cloud restore boundary');
  await page.locator('#btn-wipe').click();
  assert((await page.locator('#confirm-dialog').textContent()).includes('депозит'),'Clear scope incomplete');
  await page.locator('#confirm-dialog [value="cancel"]').click();
  assert(await page.evaluate(()=>authToken==='1'.repeat(64)&&habits.length>0),'Cancel clear changed data');passed.push('clear cancellation');
  await page.route('**/api/auth/me',r=>r.abort());
  await page.evaluate(()=>apiBootstrap());
  assert(await page.evaluate(()=>authToken==='1'.repeat(64)),'Network failure signed out');
  assert(await page.locator('#connection-state').isVisible(),'No sync error UI');
  await page.unroute('**/api/auth/me');await page.locator('#connection-state button').click();
  await page.waitForFunction(()=>!supportSyncBusy&&!supportSyncError);passed.push('network failure and retry');
  await page.context().setOffline(true);
  await page.waitForFunction(()=>!navigator.onLine);
  assert((await page.locator('#connection-state').textContent()).includes('Нет сети'),'Offline state missing');
  const token=await page.evaluate(async()=>{await apiBootstrap();return authToken;});assert(token==='1'.repeat(64),'Offline startup erased session');
  await page.context().setOffline(false);await page.locator('#connection-state button').click();
  await page.waitForFunction(()=>!supportSyncBusy);passed.push('offline cache and retained session');
  for(const width of [320,390,430,1440]) {
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Settings overflow '+width);
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('.toast').waitFor({state:'hidden'});
  await page.screenshot({path:'test-results/support-settings.png',fullPage:true});passed.push('responsive settings');
  await page.locator('a[href="privacy.html?from=profile"]').click();
  assert(await page.locator('h1').textContent()==='Политика конфиденциальности','Document missing');
  assert(await page.locator('p').first().evaluate(el=>getComputedStyle(el).fontSize)==='13px','Version label changed unexpectedly');
  assert(await page.locator('main > p').nth(1).evaluate(el=>getComputedStyle(el).lineHeight)==='24px','Policy text not 16/24');
  await page.setViewportSize({width:320,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Policy overflow');
  await page.screenshot({path:'test-results/support-privacy.png',fullPage:true});
  await page.locator('.back').first().click();await page.waitForURL('**/*#profile');passed.push('policy readability and return');
  // Dedicated local sandbox: no signed-in account, no server writes.
  const context=await page.context().browser().newContext();const local=await context.newPage();
  local.on('pageerror',e=>errors.push(e.message));
  try {
    await local.addInitScript(()=>localStorage.setItem('disbit_intro_v1','1'));
    await local.goto('http://localhost:3337/#profile');
    await local.evaluate(()=>{authGateActive=false;closeSheet('auth-overlay');document.getElementById('profile-data').open=true;});
    const backup={app:'disbit',version:5,habits:[{id:'local-proof',name:'Локальная прогулка',icon:'svg:i-h-run',color:'#36C58A',goal:{type:'check'},stake:{mode:'money',amount:0},schedule:[0,1,2,3,4,5,6],history:{},counts:{}}],ledger:[],friends:[],goals:[{id:'local-goal',name:'Путь к морю',steps:5,habitIds:['local-proof'],scene:'desert',progress:0}],rewards:[],backlog:[],profile:{name:'Локальный путешественник',bit:42,owned:['gear:hat'],gear:'hat'},settings:{theme:'blue',showOffday:false,motion:'reduce'}};
    const startImport=async text=>local.evaluate(text=>{window.restoreDone=importData(new File([text],'restore.json',{type:'application/json'}));},text);
    await startImport(JSON.stringify(backup));await local.locator('#confirm-dialog [value="cancel"]').click();await local.evaluate(()=>restoreDone);
    assert(await local.evaluate(()=>habits.length===0),'Cancelled restore changed data');passed.push('local restore cancel');
    await startImport(JSON.stringify(backup));await local.locator('#confirm-dialog [value="confirm"]').click();await local.evaluate(()=>restoreDone);
    assert(await local.evaluate(()=>habits[0]?.color==='#36C58A'&&profile.bit===42&&profile.owned.includes('gear:hat')&&goals[0].scene==='desert'&&settings.motion==='reduce'),'Backup lost visual state');passed.push('restore colors, scene, gear, bits, settings');
    const before=await local.evaluate(()=>JSON.stringify({habits,profile,settings,goals}));
    for(const corrupt of ['{broken',JSON.stringify({...backup,habits:[null]}),JSON.stringify({...backup,profile:{owned:{}}}),JSON.stringify({...backup,habits:[backup.habits[0],backup.habits[0]]}),JSON.stringify({...backup,version:99})]) {
      await startImport(corrupt);await local.evaluate(()=>restoreDone);
      assert(await local.evaluate(()=>JSON.stringify({habits,profile,settings,goals}))===before,'Malformed file mutated data');
    }
    passed.push('invalid files preserve state');
    await local.evaluate(()=>{window.originalSet=Storage.prototype.setItem;window.failOnce=true;Storage.prototype.setItem=function(k,v){if(k===PROFILE_KEY&&failOnce){failOnce=false;throw new DOMException('Full','QuotaExceededError');}return originalSet.call(this,k,v);};});
    await startImport(JSON.stringify({...backup,profile:{...backup.profile,name:'Не должно сохраниться'}}));
    await local.locator('#confirm-dialog [value="confirm"]').click();await local.evaluate(()=>restoreDone);
    assert(await local.evaluate(()=>JSON.stringify({habits,profile,settings,goals}))===before,'Quota error mutated memory');
    assert(await local.evaluate(()=>JSON.parse(localStorage.getItem(PROFILE_KEY)).name)==='Локальный путешественник','Quota rollback lost old profile');
    await local.evaluate(()=>Storage.prototype.setItem=originalSet);passed.push('storage failure rollback');
    await local.locator('#btn-wipe').click();await local.locator('#confirm-dialog [value="confirm"]').click();
    await local.waitForFunction(()=>!localStorage.getItem('disbit_habits_v1'));
    assert(await local.evaluate(()=>!authToken&&habits.length===0),'Local clear failed');passed.push('local clear');
  } finally {await context.close();}
  assert(errors.length===0,errors.join('\n'));
  return {passed,pageErrors:errors};
  } catch(e) {throw Error('Passed: '+passed.join(', ')+'\n'+e.message);}
}
