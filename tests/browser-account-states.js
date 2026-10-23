// Additional spec 19–20 UI states. Provider/mail responses are mocks, never live payments/mail.
async page => {
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.unrouteAll({behavior:'ignoreErrors'});
  await page.goto('http://localhost:3337/#profile');await page.reload();
  // Re-running this last suite starts from fixture user 1 again; no production credentials.
  if(await page.evaluate(()=>authUser?.login!=='beta_tester')) {
    await page.evaluate(()=>setAuth('1'.repeat(64),{id:1,login:'beta_tester',email:'beta_tester@example.invalid',emailVerified:true}));
    await page.reload();
  }
  await page.waitForFunction(()=>myLogin==='beta_tester' && wallet);
  await page.evaluate(()=>document.getElementById('profile-money').open=true);
  const realWallet=await page.evaluate(()=>structuredClone(wallet));
  await page.evaluate(()=>{wallet=null;walletLoading=true;renderWallet();});
  assert(await page.locator('.wallet-skeleton').count()===1,'No loading placeholder');
  assert(!(await page.locator('#wallet-balance').textContent()).includes('0 ₽'),'Loading displayed fake zero');
  await page.evaluate(w=>{wallet=w;walletLoading=false;renderWallet();},realWallet);
  // Cancelled topup form must not alter the balance.
  await page.locator('#btn-topup').click();await page.locator('#topup-custom').fill('200');await page.locator('#topup-cancel').click();
  assert(await page.evaluate(b=>wallet.balance===b,realWallet.balance),'Cancel changed balance');
  // Return alone is not a success; the matching provider transaction is required.
  await page.evaluate(()=>sessionStorage.setItem(paymentKey(),JSON.stringify({providerId:'fixture-pending',amount:5000})));
  await page.goto('http://localhost:3337/?paid=1#profile');await page.waitForFunction(()=>wallet&&!walletLoading);
  assert((await page.locator('#wallet-state').textContent()).includes('не подтверждён'),'Payment return faked success');
  assert(await page.locator('#btn-topup').isDisabled(),'Pending payment allows repeat');
  for(const status of ['cancelled','failed','done']) {
    await page.evaluate(()=>sessionStorage.setItem(paymentKey(),JSON.stringify({providerId:'fixture-pending',amount:5000})));
    await page.route('**/api/wallet',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...realWallet,history:[{id:999,type:'topup',amount:5000,balance_after:realWallet.balance,status,provider:'fixture',provider_id:'fixture-pending',created_at:'2026-10-18 18:00:00'}]})}));
    await page.locator('#wallet-retry').click();await page.waitForFunction(()=>!walletLoading);
    assert(await page.evaluate(()=>!pendingPayment()),'Terminal payment status kept pending');
    assert((await page.locator('#wallet-state').textContent()).includes(status==='done'?'подтверждено':status==='failed'?'не выполнено':'отменено'),'Wrong payment terminal state');
    await page.unroute('**/api/wallet');
  }
  await page.locator('#wallet-retry').click();await page.waitForFunction(()=>!walletLoading);
  // Validation failure from API remains retryable, uncertain transport failure does not encourage a second payment.
  await page.route('**/api/wallet/topup',r=>r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Тест: сумма отклонена'})}));
  await page.locator('#btn-topup').click();await page.locator('#topup-go').click();await page.locator('#topup-error').waitFor();
  assert(!(await page.locator('#topup-go').isDisabled()),'Definitive validation error blocks correction');
  await page.unroute('**/api/wallet/topup');
  await page.route('**/api/wallet/topup',r=>r.abort());
  await page.locator('#topup-go').click();await page.waitForFunction(()=>topupUncertain);
  assert(await page.locator('#topup-go').isDisabled(),'Uncertain result invites duplicate payment');
  await page.locator('#topup-cancel').click();await page.unroute('**/api/wallet/topup');
  await page.reload();await page.waitForFunction(()=>wallet&&!walletLoading);
  await page.evaluate(()=>openAuthSheet('register'));
  await page.locator('#rg-login').fill('test_account');await page.locator('#rg-email').fill('not-an-email');await page.locator('#rg-pass').fill('123456');
  await page.locator('#auth-submit').click();assert(await page.locator('#rg-email').getAttribute('aria-invalid')==='true','Registration email not validated');
  await page.locator('#rg-email').fill('nobody@example.invalid');
  await page.route('**/api/auth/register',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Тест: регистрация недоступна'})}));
  await page.locator('#auth-submit').click();await page.locator('#auth-error').waitFor();
  assert(await page.locator('#rg-email').inputValue()==='nobody@example.invalid','Registration error lost input');
  await page.unroute('**/api/auth/register');await page.locator('#auth-cancel').click();
  await page.evaluate(()=>openVerifySheet('nobody@example.invalid'));
  await page.locator('#verify-code').fill('12');await page.locator('#verify-submit').click();assert(await page.locator('#verify-error').isVisible(),'Code length validation missing');
  await page.route('**/api/auth/verify',r=>r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Тест: неверный код'})}));
  await page.locator('#verify-code').fill('123456');await page.locator('#verify-submit').click();
  await page.waitForFunction(()=>document.getElementById('verify-error').textContent.includes('неверный'));
  assert(await page.locator('#verify-code').inputValue()==='123456','Invalid code cleared input');
  await page.unroute('**/api/auth/verify');
  await page.route('**/api/auth/resend',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({configured:false})}));
  await page.locator('#verify-resend').click();await page.locator('#verify-later').click();await page.unroute('**/api/auth/resend');
  // No account must offer sign-in, not a zero-balance wallet. Restore the fixture token immediately.
  assert(await page.evaluate(()=>{const token=authToken;authToken=null;renderWallet();const ok=document.getElementById('btn-topup').textContent==='Войти'&&document.getElementById('wallet-balance').textContent==='Нужен аккаунт';authToken=token;renderWallet();return ok;}),'Signed-out wallet misleading');
  // Use the second fixture's real session. Only login response is mocked; bootstrap and private data APIs are real.
  await page.evaluate(async()=>{await apiCallStrict('PUT','/state',{data:stateBlob(),ts:Date.now()});openAuthSheet('login');});
  await page.route('**/api/auth/login',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({token:'2'.repeat(64),user:{id:2,login:'beta_friend',email:'beta_friend@example.invalid',emailVerified:true}})}));
  await page.locator('#li-id').fill('beta_friend');await page.locator('#li-pass').fill('fixture-only');await page.locator('#auth-submit').click();
  await page.waitForFunction(()=>authUser?.login==='beta_friend'&&myLogin==='beta_friend'&&wallet&&!walletLoading);
  assert(await page.evaluate(()=>habits.length===0 && !goals.length && !profile.motivation?.text && wallet?.balance===0),'Previous account data leaked');
  await page.unroute('**/api/auth/login');
  assert(errors.length===0,errors.join('\n'));
  return {passed:['wallet loading','cancel topup','return is not payment success','cancelled/failed/confirmed payment states','server validation retry','uncertain result guard','registration validation/error','code validation/error','resend unavailable','signed-out wallet','account isolation'],pageErrors:errors};
}
