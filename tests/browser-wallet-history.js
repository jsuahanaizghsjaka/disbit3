// Run with playwright-cli run-code against DISBIT_HISTORY_FIXTURE=1 on :3399.
async page => {
  const assert=(condition,message)=>{ if(!condition) throw Error(message); };
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{ if(message.type()==='error') errors.push(message.text()); });

  await page.goto('http://127.0.0.1:3399/#profile');
  await page.evaluate(()=>{
    localStorage.setItem('disbit_token_v1','a'.repeat(64));
    localStorage.setItem('disbit_intro_v1','1');
  });
  await page.reload();
  await page.waitForFunction(()=>wallet?.sandbox?.balance===175000);
  assert(await page.locator('#wallet-history .operation-row').count()===2,'Profile must show exactly two operations');
  const canceledPreview=page.locator('#wallet-history .operation-row').first();
  assert((await canceledPreview.textContent()).includes('Отменено') && (await canceledPreview.textContent()).includes('Запрос:'),'Canceled payment must be shown as a request');
  assert(await canceledPreview.locator('.ledger-amount.neutral').count()===1,'Canceled payment must not look credited');

  await page.locator('.history-link').click();
  await page.waitForFunction(()=>document.querySelectorAll('#operations-list .operation-row').length===30);
  assert(await page.locator('#operations-more').isVisible(),'Older operations must be reachable');
  await page.locator('#operations-more').click();
  await page.waitForFunction(()=>document.querySelectorAll('#operations-list .operation-row').length===36);
  assert(!(await page.locator('#operations-more').isVisible()),'Load more should disappear on the last page');
  await page.locator('#operations-list .operation-row').first().click();
  const canceledDetails=await page.locator('#operation-body').textContent();
  assert(canceledDetails.includes('fixture-canceled') && canceledDetails.includes('Не проведена') && canceledDetails.includes('Запрос:'),'Canceled payment details must not imply a credit');
  assert(await page.locator('#operation-body .operation-total.neutral').count()===1,'Canceled details must use neutral color');
  await page.locator('#operation-close').click();
  await page.locator('#operations-list .operation-row').nth(1).click();
  assert((await page.locator('#operation-body').textContent()).includes('fixture-payment-34'),'Completed operation details missing payment ID');
  await page.locator('#operation-close').click();

  await page.evaluate(()=>{
    const original=renderWalker;
    window.__walkerRenders=0;
    renderWalker=function(...args) { window.__walkerRenders++; return original(...args); };
  });
  for(const screen of ['today','marathon','friends','profile']) {
    await page.locator(`#dock [data-screen="${screen}"]`).click();
    assert(await page.locator(`#screen-${screen}`).isVisible(),`Navigation failed: ${screen}`);
  }
  assert(await page.evaluate(()=>window.__walkerRenders)===2,'Unrelated tabs rebuilt the journey scene');
  assert(await page.locator('#wallet-history .operation-row').count()===2,'Profile preview grew after navigation');
  const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}));
  assert(size.scroll<=size.viewport,'Horizontal overflow on profile');

  await page.evaluate(()=>localStorage.setItem('disbit_token_v1','b'.repeat(64)));
  await page.reload();
  await page.waitForFunction(()=>authUser?.login==='other' && wallet?.sandbox?.available);
  assert(await page.locator('#wallet-history .operation-row').count()===0,'Other account sees private operations');
  await page.locator('.history-link').click();
  await page.waitForFunction(()=>document.querySelector('#operations-state')?.textContent==='Операций пока нет.');
  assert(await page.locator('#operations-list .operation-row').count()===0,'Other account history is not empty');
  assert(errors.length===0,`Browser errors: ${errors.join(' | ')}`);
  return {accounts:2,operationsChecked:36,viewport:size.viewport,browserErrors:errors.length};
}
