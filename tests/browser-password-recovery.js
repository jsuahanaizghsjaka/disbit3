// Run through playwright-cli after requesting a code in the local recovery fixture.
// The local runner replaces __CODE__ with its synthetic outbox token only.
async page => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.locator('#reset-token').fill('__CODE__');
  await page.locator('#reset-password').fill('Profile-browser-pass-44');
  await page.locator('#reset-password-repeat').fill('Profile-browser-pass-44');
  await page.evaluate(()=>sessionStorage.setItem('disbit-path-draft:recovery-test','preserve-me'));
  let confirmed=0;
  page.on('request',request=>{if(request.url().endsWith('/password-reset/confirm'))confirmed++;});
  await page.route('**/api/state',route=>route.request().method()==='PUT'
    ? route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic sync failure'})}) : route.continue());
  await page.locator('#reset-submit').click();
  await page.waitForFunction(()=>document.querySelector('#reset-message').textContent.includes('синхронизировать'));
  if(confirmed!==0)throw Error('Password changed despite failed sync');
  if(!await page.evaluate(()=>!!localStorage.getItem('disbit_token_v1')))throw Error('Session lost on sync failure');
  await page.unroute('**/api/state');
  await page.locator('#reset-submit').click();
  await page.waitForFunction(()=>!document.querySelector('#auth-login-form').hidden && document.querySelector('#auth-note').textContent.includes('Пароль изменён'));
  const retained=await page.evaluate(()=>({token:!!localStorage.getItem('disbit_token_v1'),draft:sessionStorage.getItem('disbit-path-draft:recovery-test'),owner:localStorage.getItem('disbit_owner_v1')}));
  if(retained.token || retained.draft!=='preserve-me' || retained.owner!=='recovery_one')throw Error('Local session/data mismatch');
  await page.locator('#li-pass').fill('Profile-browser-pass-44');
  await page.locator('#auth-submit').click();
  await page.locator('#auth-overlay').waitFor({state:'hidden'});
  if(errors.length)throw Error(JSON.stringify(errors));
  return {ok:true,scenario:'profile reset, sync failure guard, draft preservation, session revocation and new login',errors};
}
