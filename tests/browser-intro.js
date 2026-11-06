async page => {
  const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const root='http://127.0.0.1:3470';
  await page.goto(root+'/#register');
  await page.evaluate(()=>{localStorage.clear();sessionStorage.clear()});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.setViewportSize({width:390,height:844});
  await page.goto(root+'/');
  await page.locator('#intro:not([hidden])').waitFor();
  assert(await page.locator('#intro button').count()===1,'Pledge must be the only button');
  await page.mouse.move(300,400); await page.mouse.wheel(0,100);
  await page.waitForFunction(()=>document.getElementById('intro').dataset.step==='journey');
  await page.waitForTimeout(220); // Independent wheel gesture, past the inertia guard.
  await page.mouse.wheel(0,-100);
  await page.waitForFunction(()=>document.getElementById('intro').dataset.step==='welcome');
  await page.mouse.click(330,400);
  assert(await page.locator('#intro').getAttribute('data-step')==='journey','Right-side click failed');
  await page.mouse.click(50,400);
  assert(await page.locator('#intro').getAttribute('data-step')==='welcome','Left-side click failed');
  const settle=async()=>page.waitForFunction(()=>{
    const s=document.querySelector('.intro-step:not([hidden])');
    return getComputedStyle(s).opacity==='1' && [...s.querySelectorAll('.intro-object,.intro-feature-list li')].every(e=>getComputedStyle(e).opacity==='1') && (s.dataset.step!=='journey'||new DOMMatrix(getComputedStyle(document.querySelector('#intro-traveler')).transform).m41===0);
  });
  for(let i=0;i<6;i++){
    await settle(); await page.mouse.move(0,0);
    await page.screenshot({path:'release-artifacts/intro-v2-0'+(i+1)+'.png'});
    if(i<5) await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.press('ArrowLeft'); assert(await page.locator('#intro').getAttribute('data-step')==='first-step','Back navigation failed');
  await page.mouse.move(330,380);await page.mouse.down();await page.mouse.move(70,380,{steps:8});await page.mouse.up();
  assert(await page.locator('#intro').getAttribute('data-step')==='commit','Swipe/drag failed');
  const pledge=page.locator('#intro-fp');
  await pledge.click();
  assert(!await pledge.evaluate(e=>e.classList.contains('is-confirmed')),'Short click confirmed');
  await pledge.focus(); await page.keyboard.press('Enter');
  assert(!await pledge.evaluate(e=>e.classList.contains('is-confirmed')),'Short Enter confirmed');
  const r=await pledge.boundingBox(), x=r.x+r.width/2, y=r.y+r.height/2;
  await page.mouse.move(x,y); await page.mouse.down(); await page.waitForTimeout(600);
  assert(await pledge.locator('.intro-fingerprint-fill').evaluate(e=>{const p=new DOMMatrix(getComputedStyle(e).transform).m22;return p>.1&&p<1}),'Hold progress not visible');
  await page.screenshot({path:'release-artifacts/intro-hold-progress.png'});
  await page.mouse.up(); await page.waitForTimeout(900);
  assert(!await pledge.evaluate(e=>e.classList.contains('is-confirmed')),'Early release confirmed');
  assert(await pledge.locator('.intro-fingerprint-fill').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m22===0),'Progress did not reset');
  await page.mouse.down(); await page.mouse.move(2,2); await page.waitForTimeout(1500); await page.mouse.up();
  assert(!await pledge.evaluate(e=>e.classList.contains('is-confirmed')),'Pointer exit confirmed');
  await pledge.focus(); await page.keyboard.down(' '); await page.waitForTimeout(300);
  await page.keyboard.press('ArrowLeft'); await page.keyboard.up(' '); await page.waitForTimeout(1200);
  assert(!await pledge.evaluate(e=>e.classList.contains('is-confirmed')),'Leaving slide confirmed');
  await page.keyboard.press('ArrowRight'); await pledge.focus(); await page.keyboard.down(' ');
  await page.waitForFunction(()=>document.getElementById('intro-fp').classList.contains('is-confirmed'));
  await page.keyboard.up(' ');
  assert((await page.locator('#intro-fp-hint').innerText()).includes('Поздравляем'),'Congratulations missing');
  await settle(); await page.screenshot({path:'release-artifacts/intro-v2-success.png'});
  await page.locator('#intro').waitFor({state:'hidden'});
  await page.locator('#auth-overlay:not([hidden])').waitFor();
  assert(await page.locator('#auth-overlay').getAttribute('data-view')==='register','Automatic registration missing');
  assert(await page.evaluate(()=>profile.intro.pledged&&localStorage.getItem('disbit_intro_v1')==='1'),'Pledge not saved');
  await page.goto(root+'/');assert(await page.locator('#intro').isHidden(),'Intro repeats');
  await page.evaluate(()=>localStorage.removeItem('disbit_intro_v1'));
  await page.goto(root+'/#login');assert(await page.locator('#intro').isHidden(),'Login intercepted');
  await page.goto(root+'/intro-preview.html');
  await page.locator('#intro:not([hidden])').waitFor();
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const [width,height] of [[320,640],[360,800],[390,844],[430,932],[844,390],[1280,900]]){
    await page.setViewportSize({width,height});
    for(let i=0;i<6;i++)await page.keyboard.press('ArrowLeft');
    for(let i=0;i<6;i++){
      assert(await page.locator('#intro').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'Horizontal overflow '+width+' slide '+i);
      if(i===5){await page.locator('#intro-fp').evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));assert(await page.locator('#intro-fp').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}),'Pledge clipped')}
      if(i<5)await page.keyboard.press('ArrowRight');
    }
  }
  const mobileContext=await page.context().browser().newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try {
    const mobile=await mobileContext.newPage();
    await mobile.goto(root+'/intro-preview.html');
    await mobile.locator('#intro:not([hidden])').waitFor();
    const cdp=await mobileContext.newCDPSession(mobile);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:330,y:420}]});
    for(const x of [290,250,210,170,130,90])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:420}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert(await mobile.locator('#intro').getAttribute('data-step')==='journey','Mobile touch swipe failed');
    await mobile.touchscreen.tap(50,400);
    assert(await mobile.locator('#intro').getAttribute('data-step')==='welcome','Mobile back tap failed');
    await mobile.touchscreen.tap(330,400);
    assert(await mobile.locator('#intro').getAttribute('data-step')==='journey','Mobile forward tap failed');
    await mobile.emulateMedia({reducedMotion:'reduce'});
    for(let i=0;i<4;i++)await mobile.keyboard.press('ArrowRight');
    const mp=mobile.locator('#intro-fp');
    await mp.scrollIntoViewIfNeeded();
    const mr=await mp.boundingBox(), point={x:mr.x+mr.width/2,y:mr.y+mr.height/2};
    await mobile.touchscreen.tap(point.x,point.y);
    assert(!await mp.evaluate(e=>e.classList.contains('is-confirmed')),'Mobile tap confirmed');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
    await mobile.waitForTimeout(400);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    await mobile.waitForTimeout(1100);
    assert(!await mp.evaluate(e=>e.classList.contains('is-confirmed')),'Canceled touch confirmed');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
    await mobile.waitForFunction(()=>document.getElementById('intro-fp').classList.contains('is-confirmed'));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await mobile.screenshot({path:'release-artifacts/intro-hold-mobile-success.png'});
    await mobile.waitForURL('**/#register');
  } finally {await mobileContext.close();}
  assert(errors.length===0,errors.join('\n'));
  return {passed:['six slides','only pledge button','wheel/tap/swipe navigation','short click rejected','early release resets progress','pointer exit cancels','slide change cancels','keyboard hold','mobile touch cancellation','mobile hold with reduced motion','congratulations','automatic registration','one-time completion','explicit login','six viewport sizes'],pageErrors:errors};
}

