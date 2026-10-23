// Run after browser-beta.js, using the same fixture and isolated browser session.
async page => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  await page.reload();
  await page.waitForFunction(() => myLogin === 'beta_tester' && habits.length === 3);

  // Calendar cannot bypass confirmation, including the counter decrement.
  await page.locator('#week-strip .day.today').click();
  await page.locator('[data-dtoggle="beta-check"]').click();
  await page.locator('#confirm-dialog [value="cancel"]').click();
  assert(await page.evaluate(() => doneOn(habits.find(h => h.id === 'beta-check'), TODAY)), 'Calendar silently undid completed promise');
  await page.keyboard.press('Escape');

  // Failed deletion does not remove data or close the details underneath.
  await page.route('**/api/habits/beta-check', async route => {
    if (route.request().method() === 'DELETE') await route.fulfill({ status: 503, json: { error: 'Тест: сервер недоступен' } });
    else await route.continue();
  });
  await page.locator('[data-stats="beta-check"]').click();
  await page.locator('#hstat-menu-btn').click();
  await page.locator('#hstat-del').click();
  await page.locator('#confirm-dialog [value="confirm"]').press('Space', {delay:1100});
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('Тест: сервер'));
  assert(await page.evaluate(() => habits.some(h => h.id === 'beta-check')), 'Failed deletion removed data');
  assert(await page.locator('#hstat-overlay').isVisible(), 'Failed deletion closed details');
  await page.unroute('**/api/habits/beta-check');
  await page.keyboard.press('Escape');

  // Network error is not mistaken for an empty friends list; retry recovers.
  await page.route('**/api/friends', route => route.fulfill({ status: 503, json: { error: 'Тест: нет связи' } }));
  await page.locator('#dock [data-screen="friends"]').click();
  await page.locator('#friends-retry').waitFor();
  assert(await page.locator('.friend-card').count() === 1, 'Network failure erased cached friends');
  await page.unroute('**/api/friends');
  await page.locator('#friends-retry').click();
  await page.waitForFunction(() => !friendsLoading && !friendsError);
  assert(!(await page.locator('#friends-retry').count()), 'Retry left error visible');

  // Failed upload keeps the blob and completed day; successful retry closes it.
  await page.locator('#dock [data-screen="today"]').click();
  await page.locator('[data-check="beta-count"]').click();
  await page.locator('[data-check="beta-count"]').click();
  await page.locator('#completion-dialog [value="share"]').click();
  // Camera is not available in CI. Supply a fixture image, not a real person's media.
  await page.evaluate(() => {
    proofBlob = new Blob(['local-test-image'], { type: 'image/jpeg' });
    proofType = 'photo';
    proofShowPreview('data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>'), 'photo');
  });
  await page.route('**/api/proofs?*', route => route.fulfill({ status: 503, json: { error: 'Test upload failure' } }));
  await page.locator('#proof-send').press('Space', {delay:1100});
  await page.waitForFunction(() => !proofSending);
  assert(await page.evaluate(() => !!proofBlob && !!proofHabit && isDoneToday(proofHabit)), 'Failed upload lost photo/completion');
  assert(await page.locator('#proof-overlay').isVisible(), 'Failed upload closed preview');
  await page.unroute('**/api/proofs?*');
  await page.route('**/api/proofs?*', route => route.fulfill({ status: 201, json: { ok: true } }));
  await page.locator('#proof-send').press('Space', {delay:1100});
  await page.waitForFunction(() => document.getElementById('proof-overlay').hidden);
  assert(await page.evaluate(() => habits.find(h => h.id === 'beta-count').counts[TODAY] === 2), 'Successful upload changed count');
  await page.unroute('**/api/proofs?*');

  // Reduced motion: no character animation; Escape safely keeps the completion.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('[data-check="beta-check"]').click();
  await page.locator('#confirm-dialog [value="confirm"]').press('Space', {delay:1100});
  await page.waitForFunction(() => !isDoneToday(habits.find(h => h.id === 'beta-check')));
  await page.locator('[data-check="beta-check"]').click();
  await page.locator('#completion-dialog[open]').waitFor();
  assert(await page.locator('#completion-scenes .w-walker').evaluate(n => n.getAnimations().length === 0), 'Reduced motion ignored');
  await page.keyboard.press('Escape');
  assert(await page.evaluate(() => isDoneToday(habits.find(h => h.id === 'beta-check'))), 'Escape from celebration reset completion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // Selected colors survive server bootstrap; long names fit narrow screens.
  await page.reload();
  await page.waitForFunction(() => myLogin === 'beta_tester' && habits.length === 3);
  const colored = await page.evaluate(() => habits.find(h => h.name === 'Цветное обещание'));
  assert((await page.locator(`[data-hid="${colored.id}"]`).getAttribute('style')).includes(colored.color), 'Reload lost card color');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.locator('#dock [data-screen="friends"]').click();
  await page.waitForFunction(() => !friendsLoading);
  assert(await page.evaluate(() => scrollY === 0), 'Navigation did not start from screen title');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Long friend name overflows narrow viewport');
  await page.screenshot({ path: 'test-results/friends-320.png', fullPage: true });
  assert(errors.length === 0, 'Page errors: ' + errors.join(', '));
  return { passed: ['calendar confirmation', 'failed deletion', 'friends error/retry', 'proof error/retry', 'reduced motion', 'color persistence', 'navigation scroll reset', 'long names at 320px'], pageErrors: errors };
}
