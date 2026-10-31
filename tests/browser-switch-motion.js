// Isolated DOM fixture: the callback never writes real settings.
async page => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:3399/');
  await page.evaluate(() => {
    const el = document.createElement('button');
    el.id = 'test-switch'; el.className = 'aswitch'; el.setAttribute('role', 'switch');
    el.setAttribute('aria-checked', 'false');
    el.innerHTML = '<span class="as-thumb"><span class="as-thumb-art"></span></span>';
    Object.assign(el.style, {position:'fixed', top:'20px', left:'20px', zIndex:'99999'});
    document.body.append(el); window.switchEvents = [];
    initSwitch(el, value => window.switchEvents.push(value));
  });
  const el = page.locator('#test-switch');
  await el.focus(); await page.keyboard.press('Space');
  if (await el.getAttribute('aria-checked') !== 'true') throw Error('keyboard did not toggle');
  const box = await el.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 15); await page.mouse.down();
  await page.mouse.move(box.x + 10, box.y + 15, {steps:5}); await page.mouse.up();
  const state = await page.evaluate(() => {
    const e = document.getElementById('test-switch'), thumb = e.querySelector('.as-thumb');
    return {checked:e.getAttribute('aria-checked'), events:window.switchEvents,
      transform:thumb.style.transform, width:getComputedStyle(thumb).width,
      height:getComputedStyle(thumb).height};
  });
  if (state.checked !== 'false' || JSON.stringify(state.events) !== '[true,false]' ||
      state.width !== '32px' || state.height !== '24px' || !state.transform.includes('0px') || errors.length)
    throw Error(JSON.stringify({state,errors}));
  await page.emulateMedia({reducedMotion:'reduce'});
  const reduced = await page.evaluate(() => {
    const e=document.getElementById('test-switch'); e.classList.add('grabbing');
    return getComputedStyle(e.querySelector('.as-thumb-art')).transform;
  });
  await page.emulateMedia({reducedMotion:'no-preference'});
  if (reduced !== 'none') throw Error(`reduced motion still stretches: ${reduced}`);
  return {ok:true,...state,reduced,errors};
}
