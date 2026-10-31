// Run with playwright-cli against an isolated local frontend.
async page => {
  const assert=(condition,message)=>{if(!condition) throw Error(message);};
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3471/');
  await page.evaluate(()=>{
    const input=document.createElement('input');input.type='date';input.id='audit-wheel-date';input.value='2028-01-31';document.body.append(input);
    openDisbitWheel(input,'Дата');
    const strips=[...document.querySelectorAll('.motion-wheel-strip')];
    window.__wheelMutations=0;
    window.__wheelObserver=new MutationObserver(records=>window.__wheelMutations+=records.reduce((n,r)=>n+r.addedNodes.length+r.removedNodes.length,0));
    strips.forEach(s=>window.__wheelObserver.observe(s,{childList:true}));
  });
  const day=page.getByRole('spinbutton',{name:'День'}),month=page.getByRole('spinbutton',{name:'Месяц'});
  await month.focus();await page.keyboard.press('ArrowDown');
  assert(await day.getAttribute('aria-valuenow')==='29','February must clamp day in leap year');
  const drum=await day.boundingBox();
  await page.mouse.move(drum.x+drum.width/2,drum.y+drum.height/2);await page.mouse.down();
  for(let i=0;i<16;i++) await page.mouse.move(drum.x+drum.width/2,drum.y+drum.height/2+i*4);
  await page.mouse.up();
  assert(await page.evaluate(()=>window.__wheelMutations)===0,'Wheel drag recreated rows');
  await page.getByRole('button',{name:'Выбрать',exact:true}).click();
  const saved=await page.locator('#audit-wheel-date').inputValue();
  assert(saved.startsWith('2028-02-'),'Date selection was not saved');
  await page.evaluate(()=>openDisbitWheel(document.querySelector('#audit-wheel-date'),'Дата'));
  await page.getByRole('spinbutton',{name:'Месяц'}).focus(); await page.keyboard.press('ArrowDown');
  await page.getByRole('button',{name:'Отмена',exact:true}).click();
  assert(await page.locator('#audit-wheel-date').inputValue()===saved,'Cancel changed backing value');
  await page.evaluate(()=>{
    settings.motion='reduce'; const b=document.createElement('button');b.id='audit-hold';b.textContent='Тест удержания';
    Object.assign(b.style,{position:'fixed',left:'20px',top:'20px',width:'180px',height:'60px',zIndex:'99999'});
    document.body.append(b);window.__holdCommits=0;b.addEventListener('click',()=>window.__holdCommits++);enhanceHoldButton(b);
  });
  const hold=page.locator('#audit-hold'), rect=await hold.boundingBox();
  await page.mouse.move(rect.x+30,rect.y+30);await page.mouse.down();
  assert(await page.evaluate(()=>document.querySelector('#audit-hold .hold-fill')?.getAnimations().length===0),'Reduced motion created a hold animation');
  await page.mouse.up();assert(await page.evaluate(()=>window.__holdCommits)===0,'Short hold committed');
  await page.mouse.down();await page.waitForTimeout(1100);await page.mouse.up();
  assert(await page.evaluate(()=>window.__holdCommits)===1,'Long hold must commit exactly once');
  assert(errors.length===0,`Page errors: ${errors.join('; ')}`);
  return {saved,mutations:await page.evaluate(()=>window.__wheelMutations),errors:errors.length};
}
