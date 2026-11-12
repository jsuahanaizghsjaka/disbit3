// Isolated :3337 fixture only. Registration needs two explicit, unticked-by-default consents.
async page => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  await page.setViewportSize({width:375,height:812});
  await page.goto('http://localhost:3337');
  await page.evaluate(()=>{localStorage.clear();localStorage.setItem('disbit_intro_v1','1');});
  await page.reload();
  const registerBodies=[], googleBodies=[];
  await page.route('**/api/auth/register',r=>{registerBodies.push(r.request().postDataJSON());r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Тест: регистрация недоступна'})});});
  await page.route('**/api/auth/oauth/google/start',r=>{googleBodies.push(r.request().postDataJSON());r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Тест: Google недоступен'})});});
  const error=()=>page.locator('#auth-error').textContent();

  // Login view: consent block is not shown.
  await page.evaluate(()=>openAuthSheet('login'));
  assert(!(await page.locator('#auth-consents').isVisible()),'Consents shown on login');

  // Email registration: both boxes start unticked and block the request.
  await page.evaluate(()=>{openAuthSheet('register');setAuthMode('register',true);});
  for(const id of ['#rg-accept-terms','#rg-accept-pd']){
    assert(await page.locator(id).isVisible(),id+' not visible');
    assert(!(await page.locator(id).isChecked()),id+' pre-ticked');
  }
  await page.locator('#rg-login').fill('consent_user');await page.locator('#rg-email').fill('consent@example.org');await page.locator('#rg-pass').fill('secret-123');
  await page.locator('#auth-submit').click();
  assert(/согласие/.test(await error()),'No consent error');
  assert(await page.evaluate(()=>document.activeElement.id)==='rg-accept-terms','Focus not on terms box');
  await page.locator('#rg-accept-terms').check();await page.locator('#auth-submit').click();
  assert(await page.evaluate(()=>document.activeElement.id)==='rg-accept-pd','Focus not on data box');
  assert(registerBodies.length===0,'Request sent without consents');
  await page.locator('#rg-accept-pd').check();await page.locator('#auth-submit').click();
  await page.waitForFunction(()=>/недоступна/.test(document.getElementById('auth-error').textContent));
  assert(registerBodies.length===1&&registerBodies[0].acceptTerms===true&&registerBodies[0].acceptPersonalData===true,'Consents not sent: '+JSON.stringify(registerBodies));

  // Google on the registration screen: same rule; consents travel to the server.
  await page.evaluate(()=>{setAuthMode('register');googleAvailable=true;updateGoogleControls();
    document.getElementById('rg-accept-terms').checked=false;document.getElementById('rg-accept-pd').checked=false;});
  await page.locator('#google-login-button').click();
  assert(googleBodies.length===0&&/согласие/.test(await error()),'Google started without consents');
  await page.locator('#rg-accept-terms').check();await page.locator('#rg-accept-pd').check();
  await page.locator('#google-login-button').click();
  await page.waitForFunction(()=>/Google недоступен/.test(document.getElementById('auth-error').textContent));
  assert(googleBodies[0]?.acceptTerms===true&&googleBodies[0]?.acceptPersonalData===true,'Google consents not sent');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  assert(!overflow,'Horizontal scroll on registration');
  await page.screenshot({path:'test-results/register-consent.png'});

  // Legal pages exist, carry the anchors the checkbox links use, and fit a phone.
  for(const [url,anchors] of [['terms.html',['content','refunds']],['consent.html',[]]]){
    const r=await page.goto('http://localhost:3337/'+url);assert(r.status()===200,url+' '+r.status());
    for(const a of anchors) assert(await page.locator('#'+a).count()===1,url+' missing #'+a);
    assert(await page.locator('.draft').count()===1,url+' missing draft notice');
    assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),url+' overflows');
  }
  await page.goto('http://localhost:3337/terms.html');await page.screenshot({path:'test-results/terms.png',fullPage:false});
  assert(errors.length===0,`Browser errors: ${errors.join(', ')}`);
  return {login:'hidden',email:'blocked→sent',google:'blocked→sent',pages:2,errors:errors.length};
}
