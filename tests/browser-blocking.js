async page => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
  await page.goto('http://127.0.0.1:3399');
  await page.evaluate(()=>{
    localStorage.setItem('disbit_token_v1','a'.repeat(64));
    localStorage.setItem('disbit_owner_v1','tester');
    localStorage.setItem('disbit_intro_v1','1');
  });
  await page.goto('http://127.0.0.1:3399/#profile');
  for(const viewport of [{width:390,height:844},{width:1280,height:900}]) {
    await page.setViewportSize(viewport);
    await page.reload();
    await page.locator('#screen-profile').waitFor({state:'visible'});
    // Existing profile disclosures are intentionally closed on entry.
    const settings=page.locator('#capability-open');
    await page.evaluate(()=>{
      const el=document.getElementById('capability-open');
      let parent=el.parentElement;
      while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement}
    });
    await page.getByRole('button',{name:'Блокировка приложений',exact:true}).click();
    await settings.click();
    await page.locator('#capability-overlay').waitFor({state:'visible'});
    assert(await page.locator('#blocking-native-controls').isHidden(),'Web must not offer native permissions');
    assert(await page.locator('#capability-overlay').innerText().then(t=>t.includes('В браузере ограничивать')),'Missing web limitation');
    await page.screenshot({path:`release-artifacts/blocking-web-${viewport.width}.png`});
    await page.locator('[data-close-sheet="capability-overlay"]').click();
  }
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{
    // Bridge mock tests web routing/errors only, NOT operating-system blocking.
    window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:()=>true,
      registerPlugin:()=>({openSettings:async()=>{throw Error('permission fixture')}})};
  });
  await page.locator('#capability-open').click();
  await page.locator('#blocking-native-open').click();
  await page.waitForFunction(()=>document.getElementById('blocking-native-status').textContent.includes('Не удалось'));
  assert(await page.locator('#blocking-native-open').isEnabled(),'Native failure must allow retry');
  await page.screenshot({path:'release-artifacts/blocking-native-bridge-error.png'});
  assert(errors.length===0,errors.join('\n'));
  console.log('Blocking web fallback passed at mobile and desktop sizes; no page errors.');
}
