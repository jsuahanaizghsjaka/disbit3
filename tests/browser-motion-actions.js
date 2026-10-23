// Run after browser-motion.js on the same disposable fixture.
async page => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const hold=async locator=>{await locator.focus();await page.keyboard.down('Space');await page.waitForTimeout(1100);await page.keyboard.up('Space');};
  await page.reload();await page.waitForFunction(()=>myLogin==='beta_tester');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#dock [data-screen="today"]').click();
  await page.locator('#btn-add').click();await page.locator('#create-promise').click();
  await page.locator('#f-name').fill('Проверка удержания');
  await page.locator('#btn-save').click();
  assert(await page.evaluate(()=>!habits.some(h=>h.name==='Проверка удержания')),'Brief press created habit');
  await hold(page.locator('#btn-save'));
  await page.waitForFunction(()=>habits.some(h=>h.name==='Проверка удержания'));
  const id=await page.evaluate(()=>habits.find(h=>h.name==='Проверка удержания').id);
  await page.locator(`[data-stats="${id}"]`).click();await page.locator('#hstat-menu-btn').click();await page.locator('#hstat-skip').click();
  await hold(page.locator('#confirm-dialog [value="confirm"]'));
  await page.waitForFunction(id=>isSkipOn(habits.find(h=>h.id===id),TODAY),id);
  assert(await page.locator('#hstat-skip').isDisabled(),'Skip can be spent twice');
  await page.locator('#hstat-menu-btn').click();await page.locator('#hstat-del').click();
  // Alternative confirmation is deliberately separate and works without long press.
  await page.locator('#confirm-dialog .hold-help summary').click();await page.locator('#confirm-dialog .hold-help button').click();
  await page.waitForFunction(id=>!habits.some(h=>h.id===id),id);
  // Real send handler, fixture media/network. No camera or external upload.
  await page.evaluate(()=>{
    openProofBanner(habits.find(h=>h.id==='beta-check'));
    proofBlob=new Blob(['fixture'],{type:'image/jpeg'});proofType='photo';
    proofShowPreview('data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>'),'photo');
  });
  let sends=0;
  await page.route('**/api/proofs?*',r=>{sends++;return r.fulfill({status:201,json:{ok:true}});});
  await page.locator('#proof-send').click();assert(sends===0,'Brief press uploaded proof');
  await hold(page.locator('#proof-send'));
  await page.waitForFunction(()=>document.getElementById('proof-overlay').hidden);assert(sends===1,'Hold sent duplicate proof');
  await page.unroute('**/api/proofs?*');
  // Existing paid theme ownership is preserved; test unlock lives only in fixture.
  await page.evaluate(()=>{profile.owned.push('theme:white');switchScreen('avatar');});
  await page.getByRole('button',{name:'Цвет Белый',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='white');
  await page.getByRole('button',{name:'Цвет Синий',exact:true}).click();
  await page.waitForFunction(()=>!document.documentElement.dataset.theme);
  await page.locator('#dock [data-screen="profile"]').click();
  await page.locator('#profile-settings > summary').click();await page.getByRole('button',{name:'Оформление и движение',exact:true}).click();
  await page.screenshot({path:'test-results/motion-settings.png',fullPage:true});
  // Actual pointer drag on cord, released animation must settle to rest.
  const handle=page.locator('.cord-handle');await handle.scrollIntoViewIfNeeded();
  const r=await handle.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();
  await page.mouse.move(r.x+r.width/2,r.y+r.height/2+35,{steps:8});await page.mouse.up();
  assert(await page.locator('.profile-cord button').getAttribute('aria-checked')==='true','Cord drag failed');
  await page.waitForTimeout(1400);
  const restingPath=await page.locator('.cord-line').getAttribute('d');await page.waitForTimeout(250);
  assert(await page.locator('.cord-line').getAttribute('d')===restingPath,'Cord animation did not sleep');
  await page.locator('#btn-profile-edit').click();await page.screenshot({path:'test-results/motion-avatar.png'});await page.locator('#pf-cancel').click();
  await page.locator('#dock [data-screen="marathon"]').click();await page.locator('#btn-goal-add').click();await page.locator('#g-steps + .wheel-open').click();
  const drum=page.getByRole('spinbutton',{name:'Дни',exact:true});const d=await drum.boundingBox();
  await page.mouse.move(d.x+d.width/2,d.y+d.height/2);await page.mouse.down();await page.mouse.move(d.x+d.width/2,d.y+d.height/2-80,{steps:8});await page.mouse.up();
  assert(await drum.getAttribute('aria-valuenow')==='32','Wheel drag not reflected');
  await page.screenshot({path:'test-results/motion-wheel.png'});await page.locator('[data-wheel-cancel]').click();await page.locator('#g-cancel').click();
  assert(errors.length===0,errors.join('; '));
  return {ok:true,checks:'create/skip/delete/send, one-send-only, accessible alternative, theme reveal, rope drag and sleep, wheel drag',errors};
}
