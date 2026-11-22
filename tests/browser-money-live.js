// Live deposit UI against tests/money-live-fixture.mjs on :3421 (control :3422).
async page => {
  const assert=(value,message)=>{ if(!value) throw Error(message); };
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:390,height:844});
  const shot=async name=>{await page.waitForTimeout(500);await page.screenshot({path:`test-results/money-${name}.png`,fullPage:false});};
  const login=async(id,name)=>{
    await page.goto('http://localhost:3421/');
    await page.evaluate(([id,name])=>{localStorage.clear();localStorage.setItem('disbit_intro_v1','1');
      localStorage.setItem('disbit_token_v1',String(id).repeat(64));localStorage.setItem('disbit_owner_v1',name);
      localStorage.setItem('disbit_auth_user_v1',JSON.stringify({id,login:name,emailVerified:true}));},[id,name]);
    await page.goto(`http://localhost:3421/?account=${id}#profile`);
    await page.waitForFunction(()=>wallet?.payments?.live===true);
    await page.evaluate(()=>{switchScreen('profile');document.getElementById('profile-money').open=true;});
  };
  // The payment page is outside the app; it is stubbed and never contacted.
  await page.route('https://yoomoney.ru/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Оплата ЮKassa</h1>'}));

  await login(1,'payer');
  assert(await page.locator('#wallet-sim').isHidden(),'live wallet must not show the simulation note');
  assert(await page.locator('#wallet-legal').isHidden(),'current edition must not ask again');
  assert((await page.locator('#wallet-mode').textContent()).includes('ЮKassa'),'wallet mode must name the provider');
  await page.locator('#wallet-card').scrollIntoViewIfNeeded(); await shot('1-wallet-empty');

  // Top-up: fee on top, then the payment page.
  await page.locator('#btn-topup').click();
  assert(await page.locator('.topup-chip.on').evaluate(el=>el===document.activeElement),'focus must match selected amount');
  await page.locator('#topup-custom').fill('1');
  assert((await page.locator('#topup-go').textContent()).includes('1,04 ₽'),'custom total');
  await page.locator('#topup-custom').fill('');
  assert(await page.locator('.topup-chip.on').getAttribute('data-sum')==='30000','restore default amount');
  await page.locator('#topup-amounts [data-sum="50000"]').click();
  assert(await page.locator('#topup-fee').count()===0,'fee breakdown must not be printed in the sheet');
  assert((await page.locator('#topup-go').textContent()).includes('519 ₽'),'500 ₽ plus fee must show 519 ₽');
  assert(!(await page.locator('#topup-overlay').textContent()).match(/черновик|демо|тестов/i),'top-up sheet must not mention a draft or test mode');
  await shot('2-topup-sheet');
  await Promise.all([page.waitForURL(/yoomoney\.ru/),page.locator('#topup-go').click()]);

  // Back in the app before paying: the payment can be continued.
  await page.goto('http://localhost:3421/#profile');
  await page.waitForFunction(()=>wallet?.pending?.amount===50000);
  await page.evaluate(()=>{switchScreen('profile');document.getElementById('profile-money').open=true;});
  assert((await page.locator('#btn-topup').textContent()).includes('Продолжить оплату'),'open payment must be resumable');
  await page.locator('#wallet-card').scrollIntoViewIfNeeded(); await shot('3-wallet-pending');
  // A stale screen (page restored by «Назад») that does not know about the open
  // payment: the same amount continues it instead of showing an error.
  const firstUrl=await page.evaluate(()=>{const url=wallet.pending.url;wallet.pending=null;renderWallet();return url;});
  await page.locator('#btn-topup').click();
  await page.locator('#topup-amounts [data-sum="50000"]').click();
  await Promise.all([page.waitForURL(url=>url.href===firstUrl),page.locator('#topup-go').click()]);
  await page.goto('http://localhost:3421/#profile');
  await page.waitForFunction(()=>wallet?.pending?.amount===50000);
  await page.evaluate(()=>{switchScreen('profile');document.getElementById('profile-money').open=true;});

  // The bank confirms; the app asks the server, never trusts the return.
  await fetch('http://127.0.0.1:3422/pay',{method:'POST'});
  const providerId=await page.evaluate(()=>wallet.history[0].provider_id);
  await fetch('http://localhost:3421/api/wallet/webhook',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({type:'notification',event:'payment.succeeded',object:{id:providerId}})});
  await page.evaluate(()=>loadWallet());
  await page.waitForFunction(()=>wallet?.balance===50000&&!wallet.pending);
  const row=await page.locator('#wallet-history .operation-row').first().textContent();
  assert(row.includes('Пополнение')&&row.includes('+500'),'credited top-up must be listed: '+row);
  await page.locator('#wallet-history .operation-row').first().click();
  const details=await page.locator('#operation-body').textContent();
  assert(details.includes('ЮKassa')&&details.includes('19 ₽'),'details must name the provider and the fee: '+details);
  await shot('4-operation');
  await page.locator('#operation-close').click();

  // Refund part of the free balance.
  await page.locator('#refund-box summary').click();
  await page.locator('#refund-amount').fill('200');
  await page.locator('#refund-go').click();
  await page.waitForFunction(()=>wallet?.balance===30000);
  assert((await page.locator('#refund-status').textContent()).includes('отправлен'),'refund status must be shown');
  await page.locator('#refund-box').scrollIntoViewIfNeeded(); await shot('5-refund');

  // Money condition for an existing promise with a money penalty.
  await page.evaluate(()=>openEditSheet('run'));
  await page.waitForSelector('#money-terms:not([hidden])');
  assert(await page.locator('#recipient [data-rec="charity"]').isDisabled(),'charity must be unavailable with live money');
  const label=await page.locator('#money-terms-text').textContent();
  assert(label.includes('100 ₽')&&label.includes('30 дней'),'condition text must show amount and dispute term: '+label);
  await page.locator('#f-money-accept').check();
  await page.locator('#money-terms').scrollIntoViewIfNeeded(); await shot('6-money-condition');
  await page.evaluate(()=>submitHabit()); // the save button is press-and-hold
  await page.waitForFunction(()=>wallet?.terms?.some(t=>t.habitId==='run'&&t.amount===10000));
  await page.evaluate(()=>openEditSheet('run'));
  assert((await page.locator('#money-terms-state').textContent()).includes('действует'),'accepted condition must be shown');
  assert(await page.locator('#money-terms-row').isHidden(),'accepted condition cannot be accepted twice');
  await page.evaluate(()=>closeSheet('add-overlay'));

  // An account on an older edition is asked to accept the current one.
  await login(2,'old_edition');
  assert(await page.locator('#wallet-legal').isVisible(),'older edition must be asked to accept');
  await page.locator('#wallet-legal').scrollIntoViewIfNeeded(); await shot('7-new-edition');
  await page.locator('#btn-topup').click();
  assert(await page.locator('#topup-overlay').isHidden(),'top-up must wait for the new edition');
  await page.locator('#legal-accept-terms').check(); await page.locator('#legal-accept-pd').check();
  await page.locator('#legal-accept-go').click();
  await page.waitForFunction(()=>wallet?.legal?.current===true);
  assert(await page.locator('#wallet-legal').isHidden(),'notice must disappear after acceptance');
  assert(!errors.length,'page errors: '+errors.join('; '));
  return 'live deposit UI ok';
}
