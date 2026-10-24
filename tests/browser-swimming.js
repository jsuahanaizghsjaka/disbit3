// Run after browser-traveler-layout.js on the isolated fixture-server (port 3337).
async page => {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(() => {
    delete document.documentElement.dataset.motion;
    goals = [{id:'swim-test',name:'Заплыв к острову',scene:'ocean',steps:24,habitIds:['beta-check']}];
    switchScreen('today'); renderWalker();
  });
  await page.locator('[data-check="beta-check"]').click();
  await page.locator('#completion-dialog').waitFor({state:'visible'});
  // Inspect the real completion motion before its onfinish callback removes walking.
  await page.evaluate(() => {
    const card = document.querySelector('#completion-scenes .walker-card');
    card.classList.add('walking');
    card.getAnimations({subtree:true}).forEach(animation => { animation.pause(); animation.currentTime = 0; });
  });
  const samples = [];
  for (const time of [0,175,350,525,699]) {
    samples.push(await page.locator('#completion-scenes .walker-card').evaluate((card, time) => {
      card.getAnimations({subtree:true}).forEach(animation => { animation.pause(); animation.currentTime = time; });
      const rect = card.querySelector('.w-scene').getBoundingClientRect();
      const body = card.querySelector('.swim-body').getBoundingClientRect();
      const handY = side => card.querySelector(`.swim-forearm-${side} path`).getBoundingClientRect().top;
      return {time, farHandY:handY('far'), nearHandY:handY('near'), x:body.x,
        farLeg:getComputedStyle(card.querySelector('.swim-leg-far')).transform,
        nearLeg:getComputedStyle(card.querySelector('.swim-leg-near')).transform,
        contained:body.left >= rect.left && body.right <= rect.right && body.top >= rect.top && body.bottom <= rect.bottom};
    },time));
    await page.locator('#completion-scenes').screenshot({path:`test-results/swim-completion-${time}.png`});
  }
  assert(samples.every(s => s.contained), 'Swimmer clips during stroke');
  assert(samples[0].farHandY < samples[0].nearHandY && samples[2].farHandY > samples[2].nearHandY, 'Hands do not exchange recovery and water positions');
  assert(samples[0].farLeg !== samples[1].farLeg && samples[1].farLeg !== samples[1].nearLeg, 'Legs do not alternate kicks');
  assert(samples[4].x > samples[0].x + 20, 'Swimmer does not move forward');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const strip = document.createElement('div'); strip.id = 'swim-test-frames';
    strip.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#14233B;display:flex;align-items:center;gap:8px;overflow:auto';
    for (const time of [0,175,350,525]) {
      const frame = document.createElement('div');
      frame.className = 'walking'; frame.style.cssText = 'width:300px;flex-shrink:0;color:#F4F7FF;text-align:center';
      frame.innerHTML = `<svg viewBox="0 -25 270 160" width="300" height="220">${swimmingTravelerArtwork()}</svg><p>${time} ms</p>`;
      strip.append(frame);
    }
    document.body.append(strip);
    [...strip.children].forEach((frame,index) => frame.getAnimations({subtree:true}).forEach(animation => { animation.pause(); animation.currentTime = index * 175; }));
  });
  await page.setViewportSize({width:1280,height:400});
  await page.screenshot({path:'test-results/swim-stroke-frames.png'});
  await page.evaluate(() => document.getElementById('swim-test-frames').remove());
  for (const width of [360,390,1280]) {
    await page.setViewportSize({width,height:844});
    await page.locator('#dock [data-screen="marathon"]').click();
    await page.locator('#walker').screenshot({path:`test-results/swim-marathon-${width}.png`});
    await page.locator('#dock [data-screen="today"]').click();
    await page.locator('#walker').screenshot({path:`test-results/swim-today-${width}.png`});
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('[data-check="beta-check"]').click();
  assert(await page.locator('#completion-scenes .swimmer-art').evaluate(el => el.getAnimations({subtree:true}).length === 0), 'Reduced-motion swim still animates');
  await page.keyboard.press('Escape');
  await page.emulateMedia({reducedMotion:'no-preference'});
  assert(errors.length === 0, errors.join('\n'));
  return {samples, reducedMotion:'passed', pageErrors:errors};
}
