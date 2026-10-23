// Run after the three beta suites, against the isolated fixture on :3337.
async page => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const errors = [];
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/path-ui.*', route => route.continue());
  await page.goto('http://localhost:3337/#today');
  await page.reload();
  await page.waitForFunction(() => myLogin === 'beta_tester' && habits.length >= 3);
  // Remove only this suite's fixture-created promise when retrying a failed run.
  await page.evaluate(async () => {
    for (const h of habits.filter(h => h.name === 'Утренняя прогулка')) {
      await apiCallStrict('DELETE', `/habits/${h.id}`);
      habits = habits.filter(item => item.id !== h.id);
    }
    save(); render();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/path-today.png', fullPage: true });
  assert(await page.locator('.habit').first().evaluate(el => getComputedStyle(el).backgroundColor) === 'rgb(20, 35, 59)', 'Card base differs from palette');
  assert(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor) === 'rgb(11, 19, 36)', 'Background differs from palette');

  // A failed save must leave the form and existing data intact. No duplicate submits.
  await page.locator('#btn-add').click(); await page.locator('#create-promise').click();
  await page.locator('#btn-save').press('Space', {delay:1100});
  assert(await page.locator('#habit-form-error').isVisible(), 'No inline name error');
  assert(await page.evaluate(() => document.activeElement.id === 'f-name'), 'First error not focused');
  await page.locator('#f-name').fill('Утренняя прогулка');
  await page.locator('[data-schedule="flex"]').click();
  await page.locator('#wt-plus').click();
  await page.locator('#color-picker .pick').nth(3).click();
  const color = await page.locator('#color-picker .selected').getAttribute('data-color');
  assert((await page.locator('#habit-preview').getAttribute('style')).includes(color), 'Live preview ignores color');
  await page.keyboard.press('Escape');
  await page.locator('#dock [data-screen="friends"]').click();
  await page.locator('#btn-add').click(); await page.locator('#create-promise').click();
  assert(await page.locator('#f-name').inputValue() === 'Утренняя прогулка', 'Dismissal lost draft');
  assert(await page.evaluate(() => wtValue === 2), 'Dismissal lost schedule');
  await page.reload();
  await page.waitForFunction(() => myLogin === 'beta_tester' && habits.length === 3);
  await page.locator('#btn-add').click(); await page.locator('#create-promise').click();
  assert(await page.locator('#f-name').inputValue() === 'Утренняя прогулка', 'Reload lost draft');
  assert(await page.evaluate(() => wtValue === 2), 'Reload lost draft schedule');
  assert(await page.locator('#color-picker .selected').getAttribute('data-color') === color, 'Reload lost draft color');
  await page.locator('#btn-cancel').focus();
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => document.getElementById('add-overlay').contains(document.activeElement)), 'Focus escaped form');
  let postCount = 0;
  await page.route('**/api/habits', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    postCount++;
    await page.waitForTimeout(350);
    await route.fulfill({ status: 503, json: { error: 'Тест: нет связи' } });
  });
  await page.locator('#btn-save').press('Space', {delay:1100});
  await page.locator('#habit-form-error').waitFor();
  assert(postCount === 1, 'Double submit sent more than one request');
  assert(await page.evaluate(() => habits.length === 3), 'Failed create modified habits');
  assert(await page.locator('#f-name').inputValue() === 'Утренняя прогулка', 'Failed save lost input');
  await page.screenshot({ path: 'test-results/path-form-error.png', fullPage: true });
  await page.unroute('**/api/habits');
  await page.locator('#btn-save').press('Space', {delay:1100});
  await page.waitForFunction(() => habits.some(h => h.name === 'Утренняя прогулка'));
  await page.locator('#dock [data-screen="today"]').click();
  const id = await page.evaluate(() => habits.find(h => h.name === 'Утренняя прогулка').id);

  // Failed completion does not award a bit, increase streak, or open celebration.
  const before = await page.evaluate(() => ({ bit: profile.bit, length: habits.length }));
  await page.route(`**/api/habits/${id}/day/*`, route => route.fulfill({ status: 503, json: { error: 'Тест: отметка не сохранена' } }));
  await page.locator(`[data-check="${id}"]`).click();
  await page.locator('.habit-error').waitFor();
  assert(await page.evaluate(id => !isDoneToday(habits.find(h => h.id === id)), id), 'Failed completion shown as done');
  assert(await page.evaluate(bit => profile.bit === bit, before.bit), 'Failed completion awarded a bit');
  assert(!(await page.locator('#completion-dialog').isVisible()), 'Failed completion celebrated');
  await page.unroute(`**/api/habits/${id}/day/*`);
  await page.locator(`[data-check="${id}"]`).click();
  await page.locator('#completion-dialog [value="share"]').click();

  // Permission is deferred; denial gives a retry. Closing camera preserves completion.
  await page.evaluate(() => {
    window.cameraRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => { window.cameraRequests++; throw new DOMException('Denied', 'NotAllowedError'); };
  });
  assert(await page.evaluate(() => !proofStream && cameraRequests === 0), 'Camera started without tap');
  await page.locator('#proof-start').click();
  await page.locator('#proof-cam-err').waitFor();
  assert(await page.evaluate(() => cameraRequests === 1), 'Camera request missing');
  assert(await page.locator('#proof-start').isVisible(), 'Camera retry missing');
  await page.screenshot({ path: 'test-results/path-camera-denied.png' });
  await page.locator('#proof-skip').click();
  assert(await page.evaluate(id => isDoneToday(habits.find(h => h.id === id)), id), 'No photo undid completion');

  // Share exports a real PNG, with only the promise/result/date/brand.
  await page.locator(`[data-stats="${id}"]`).click();
  await page.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#detail-share').click();
  const download = await downloadPromise;
  assert(download.suggestedFilename() === 'disbit-moment.png', 'Share did not export a card');
  await download.saveAs('test-results/path-share.png');
  await page.screenshot({ path: 'test-results/path-details.png' });
  await page.locator('[data-close-sheet="hstat-overlay"]').click();

  // Real browser history and previously scrolled tab restore.
  await page.evaluate(() => scrollTo(0, 300));
  const oldScroll = await page.evaluate(() => scrollY);
  await page.locator('#dock [data-screen="marathon"]').click();
  await page.locator('#open-avatar').click();
  assert(await page.locator('#gear-picker').count() === 1, 'Legacy avatar functionality missing');
  await page.goBack();
  await page.locator('#screen-marathon.active').waitFor();
  await page.goBack();
  await page.locator('#screen-today.active').waitFor();
  assert(Math.abs((await page.evaluate(() => scrollY)) - oldScroll) < 3, 'Tab scroll lost');

  for (const width of [320, 360, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    const result = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      items: [...document.querySelectorAll('#dock .dock-item')].map(el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right, w: r.width, h: r.height }; })
    }));
    assert(!result.overflow && result.items.every(r => r.x >= 0 && r.right <= width && r.w >= 44 && r.h >= 44), `Menu bounds at ${width}`);
    await page.locator('#btn-add').click(); await page.locator('#create-promise').click();
    assert(await page.locator('#f-name').inputValue() === '', 'Successful save left stale draft');
    await page.locator('#f-name').fill('Оченьдлинноенеразрывноеназваниеобещания123');
    assert(await page.locator('.sheet:visible').evaluate(el => el.scrollWidth <= el.clientWidth), `Form overflow at ${width}`);
    await page.locator('#btn-cancel').click();
  }
  await page.emulateMedia({ contrast: 'more', reducedMotion: 'reduce' });
  assert(await page.locator('#dock').evaluate(el => getComputedStyle(el).backdropFilter) === 'none', 'Contrast fallback missing');
  await page.emulateMedia({ contrast: 'no-preference', reducedMotion: 'no-preference' });
  await page.evaluate(() => { settings.theme = 'white'; applyTheme(); });
  assert(await page.locator('html').getAttribute('data-theme') === 'white', 'Existing theme lost');
  await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(236, 239, 244)');
  assert(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor) === 'rgb(236, 239, 244)', 'White theme visually overwritten');
  await page.evaluate(() => { settings.theme = 'blue'; applyTheme(); scrollTo(0, 0); });
  await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(11, 19, 36)');
  await page.screenshot({ path: 'test-results/path-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/path-today.png', fullPage: true });
  assert(errors.length === 0, 'Page exceptions: ' + errors.join(', '));
  return { passed: ['palette', 'inline validation', 'draft after navigation and reload', 'focus containment', 'failed save', 'double submit', 'live color preview', 'failed completion', 'camera consent and denial', 'no-photo preservation', 'share PNG', 'back history', 'scroll restore', 'five viewports', 'contrast fallback', 'existing theme'], pageErrors: errors };
}
