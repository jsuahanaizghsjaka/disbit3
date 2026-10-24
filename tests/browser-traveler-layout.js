// Run with playwright-cli run-code against tests/fixture-server.mjs only.
async page => {
  await page.emulateMedia({reducedMotion:'no-preference',colorScheme:'dark'});
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:3337');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('disbit_intro_v1', '1');
    localStorage.setItem('disbit_token_v1', '1'.repeat(64));
    localStorage.setItem('disbit_owner_v1', 'beta_tester');
    localStorage.setItem('disbit_auth_user_v1', JSON.stringify({id:1,login:'beta_tester',emailVerified:true}));
  });
  await page.reload();
  await page.waitForFunction(() => myLogin === 'beta_tester' && habits.length >= 3);
  await page.evaluate(() => {
    goals = [
      {id:'visual-desert',name:'Пустынный путь',scene:'desert',steps:30,habitIds:['beta-check']},
      {id:'visual-ocean',name:'Через океан',scene:'ocean',steps:24,habitIds:['beta-count']}
    ];
    renderWalker();
  });
  const results = [];
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({width, height:900});
    await page.evaluate(() => openAddSheet());
    await page.locator('#goal-type [data-goal="count"]').click();
    const spacing = await page.evaluate(() => {
      const segment = document.getElementById('goal-type').getBoundingClientRect();
      const fields = document.getElementById('count-fields').getBoundingClientRect();
      return fields.top - segment.bottom;
    });
    assert(spacing >= 12, `Counter fields touch at ${width}: ${spacing}`);
    await page.locator('#count-fields').scrollIntoViewIfNeeded();
    await page.screenshot({path:`test-results/traveler-form-${width}.png`});
    await page.locator('#goal-type [data-goal="check"]').click();
    assert(!(await page.locator('#count-fields').isVisible()), 'Counter fields visible for check goal');
    await page.evaluate(() => closeSheet('add-overlay'));
    await page.locator('#dock [data-screen="today"]').click();
    await page.locator('#walker [data-scene="ocean"]').scrollIntoViewIfNeeded();
    const bounds = await page.locator('#walker [data-scene="ocean"]').evaluate(card => {
      const scene = card.querySelector('.w-scene').getBoundingClientRect();
      const figure = card.querySelector('.w-swimmer .traveler-body').getBoundingClientRect();
      return {contained:figure.top >= scene.top && figure.bottom <= scene.bottom && figure.left >= scene.left && figure.right <= scene.right, height:figure.height, width:figure.width};
    });
    assert(bounds.contained && bounds.width > 35, `Swimmer clipped/tiny at ${width}: ${JSON.stringify(bounds)}`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}`);
    await page.screenshot({path:`test-results/traveler-routes-${width}.png`,fullPage:true});
    await page.locator('#dock [data-screen="marathon"]').click();
    await page.locator('#open-avatar').click();
    await page.locator('.traveler-studio').screenshot({path:`test-results/traveler-portrait-${width}.png`});
    results.push({width,spacing,bounds});
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('#dock [data-screen="marathon"]').click();
  const routeBounds = await page.evaluate(() => {
    document.documentElement.dataset.motion = 'reduce';
    const card = document.querySelector('#walker .walker-card');
    const walker = card.querySelector('.w-walker');
    const originalMarkup = walker.innerHTML;
    const originalTransform = walker.style.transform;
    const results = [];
    for (const sc of SCENES) {
      for (const progress of [0, .5, .81, .9, 1]) {
        const pos = walkerPath(sc, progress);
        walker.innerHTML = `<g transform="scale(1.7)">${walkerFigure(sc)}</g>`;
        walker.style.transform = `translate(${pos.x}px,${pos.y}px)`;
        const scene = card.querySelector('.w-scene').getBoundingClientRect();
        const figure = walker.querySelector('.traveler-body').getBoundingClientRect();
        if (figure.left < scene.left || figure.right > scene.right || figure.top < scene.top || figure.bottom > scene.bottom) results.push({scene:sc.id,progress});
      }
    }
    walker.innerHTML = originalMarkup;
    walker.style.transform = originalTransform;
    delete document.documentElement.dataset.motion;
    return results;
  });
  assert(routeBounds.length === 0, `Enlarged traveler clipped: ${JSON.stringify(routeBounds)}`);
  await page.locator('#walker').screenshot({path:'test-results/traveler-marathon-large.png'});
  await page.locator('#dock [data-screen="today"]').click();
  const desert = page.locator('#walker [data-scene="desert"]');
  await desert.scrollIntoViewIfNeeded();
  await desert.evaluate(card => card.classList.add('walking'));
  for (const time of [175, 490]) {
    const knees = await desert.evaluate((card, time) => {
      card.getAnimations({subtree:true}).forEach(animation => { animation.pause(); animation.currentTime = time; });
      return [...card.querySelectorAll('.traveler-shin-front,.traveler-shin-back')].map(knee => getComputedStyle(knee).transform);
    }, time);
    assert(knees.length === 2 && knees.some(value => value !== 'matrix(1, 0, 0, 1, 0, 0)' && value !== 'none'), 'Knees are not articulated');
    await desert.screenshot({path:`test-results/traveler-step-${time}.png`});
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  assert(await desert.evaluate(card => [...card.querySelectorAll('.traveler-art *')].every(el => getComputedStyle(el).animationName === 'none')), 'Reduced motion ignored');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(() => document.documentElement.dataset.motion = 'reduce');
  assert(await desert.evaluate(card => [...card.querySelectorAll('.traveler-art *')].every(el => getComputedStyle(el).animationName === 'none')), 'In-app reduced motion ignored');
  assert(errors.length === 0, `Browser errors: ${errors.join(', ')}`);
  return {results, knees:'animated', reducedMotion:'passed', pageErrors:errors};
}
