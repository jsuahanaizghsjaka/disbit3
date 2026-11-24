async (page) => {
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:3498/safety');
  await page.evaluate(()=>localStorage.setItem('disbit_token_v1','1'.repeat(64)));
  await page.reload();
  await page.locator('#target').fill('recovery_two');
  await page.getByRole('button',{name:'Заблокировать пользователя',exact:true}).click();
  await page.getByRole('button',{name:'Разблокировать recovery_two'}).waitFor();
  await page.locator('#reason').fill('Проверка жалобы в изолированном тесте');
  await page.getByRole('button',{name:'Отправить жалобу'}).click();
  await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('получена'));
  await page.getByRole('button',{name:'Разблокировать recovery_two'}).click();
  await page.waitForFunction(()=>document.querySelector('#blocks').textContent.includes('нет'));
  for(const width of [390,320,1280]) {
    await page.setViewportSize({width,height:844});
    for(const route of ['support','delete-account','safety','review']) {
      await page.goto('http://127.0.0.1:3498/'+route);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
      if(overflow)throw Error('Overflow '+route+' at '+width);
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:3498/delete-account');
  await page.locator('#login').fill('recovery_two');
  await page.locator('#password').fill('Old-test-pass-42');
  await page.locator('#confirm').check();
  await page.locator('#delete-submit').click();
  await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('Аккаунт удалён'));
  if(errors.length)throw Error(errors.join('\n'));
  await page.screenshot({path:'test-results/account-delete-mobile.png',fullPage:true});
  console.log('PASS: complaint, block/unblock, deletion, 320/390/1280 layouts, no page errors');
}
