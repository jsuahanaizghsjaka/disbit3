async (page)=>{
 const base='http://127.0.0.1:3499';const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',d=>d.accept());
 const login=async id=>{await page.goto(base+'/safety');await page.evaluate(id=>localStorage.setItem('disbit_token_v1',String(id).repeat(64)),id);await page.reload();};
 const admin=async()=>{await page.goto(base+'/review');await page.locator('#key').fill('local-review-fixture-12345678901234567890');await page.locator('#enter').click();await page.locator('#panel').waitFor();};
 await login(1);
 await page.locator('#target').fill('recovery_two');await page.locator('#reason').fill('Нарушение правил: тест модерации');await page.getByRole('button',{name:'Отправить жалобу',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('получена'));
 await admin();await page.getByRole('button',{name:'Ограничить социальные действия',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#reports').textContent.includes('Нет ожидающих'));
 await login(1);await page.getByText('Жалоба рассмотрена: социальные действия пользователя ограничены.',{exact:true}).waitFor();
 await login(2);await page.locator('#appeal-message').fill('Прошу пересмотреть ограничение: это тест');await page.getByRole('button',{name:'Отправить обращение',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#restriction').textContent.includes('Обращение принято'));
 await admin();await page.locator('#appeals textarea').fill('Проверено, ограничение снимается');await page.getByRole('button',{name:'Снять ограничение',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#appeals').textContent.includes('Нет ожидающих'));
 await login(2);await page.getByText('Ограничение снято. Проверено, ограничение снимается',{exact:true}).waitFor();
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('overflow '+width);}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/moderation-appeal-mobile.png',fullPage:true});
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS report -> restriction -> notice -> appeal -> lift -> notice; mobile widths; no page errors');
}
