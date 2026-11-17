// Local recovery-fixture on :3509. Requires the synthetic browser account to be signed in.
async page => {
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
  await page.reload();
  await page.waitForFunction(()=>typeof authToken==='string'&&Boolean(authUser?.id));
  const result=await page.evaluate(async()=>{
    const unit='<img src=x onerror=window.auditExecuted=1>';
    const card=habitCard({id:'audit',name:'Security test',createdAt:TODAY,history:[],counts:{},min:'',schedule:[0,1,2,3,4,5,6],goal:{type:'count',target:5,unit},stake:{mode:'money',amount:0}},false);
    document.body.append(card);
    const safe=card.querySelector('img')===null&&card.textContent.includes(unit)&&!window.auditExecuted;
    card.remove();
    const response=await fetch('/api/friends',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+'1'.repeat(64)},body:JSON.stringify({login:authUser.login})});
    if(response.status!==202)throw Error('Expected pending request');
    await loadFriends(true);
    return {safe};
  });
  if(!result.safe)throw Error('Habit unit was interpreted as markup');
  await page.locator('#dock [data-screen="friends"]').click();
  for(const width of [1280,390,320]){
    await page.setViewportSize({width,height:844});
    await page.locator('.friend-request').waitFor();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    if(overflow)throw Error('Horizontal overflow at '+width);
    await page.screenshot({path:'test-results/security-friends-'+width+'.png'});
  }
  await page.locator('.friend-request').getByRole('button',{name:'Принять',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.friend-request').length===0);
  if(errors.length)throw Error(errors.join('\n'));
  console.log('PASS: literal XSS payload, request consent, desktop/390/320 layout, no console errors');
}
