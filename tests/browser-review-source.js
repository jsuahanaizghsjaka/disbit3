// Local UI fixture; all API responses below are synthetic.
async page => {
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/proofs?*',r=>r.fulfill({json:{items:['gallery','camera','unknown'].map((source,i)=>({id:i+1,source,type:'photo',habit_name:'Проверка источника',user_login:'tester',day:'2026-11-16',status:'pending'})),counts:{pending:3}}}));
 await page.route('**/api/moderation/**',r=>r.fulfill({json:{items:[]}}));
 await page.goto('http://127.0.0.1:3399/review.html');
 await page.locator('#key').fill('synthetic-only');await page.locator('#enter').click();
 await page.locator('.p-source').first().waitFor();
 const labels=await page.locator('.p-source').allTextContents();
 if(await page.locator('.p-media').first().isVisible())throw Error('unloaded media is visible');
 if(!labels[0].includes('Из галереи')||!labels[1].includes('Камера приложения')||!labels[2].includes('Источник не указан'))throw Error('labels');
 for(const width of [320,1280]){
  await page.setViewportSize({width,height:850});
  if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))throw Error('overflow');
 }
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'test-results/phase4-review-source.png',fullPage:true});
 if(errors.length)throw Error(errors.join(';'));
 return {ok:true,labels,mobileAndDesktop:true,errors};
}
