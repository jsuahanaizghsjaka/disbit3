// Run with an isolated playwright-cli session against tests/fixture-server.mjs.
async page => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  await page.goto('http://localhost:3337');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('disbit_intro_v1', '1');
    localStorage.setItem('disbit_token_v1', '1'.repeat(64));
    localStorage.setItem('disbit_owner_v1', 'beta_tester');
    localStorage.setItem('disbit_auth_user_v1', JSON.stringify({ id: 1, login: 'beta_tester', emailVerified: true }));
  });
  await page.reload();
  await page.locator('[data-check="beta-check"]').waitFor();
  await page.waitForFunction(() => myLogin === 'beta_tester');
  await page.setViewportSize({ width: 390, height: 844 });

  // Marathon validation and selection: creating a goal must not create a habit.
  await page.locator('#dock [data-screen="marathon"]').click();
  await page.locator('#btn-goal-add').click();
  await page.locator('#g-name').fill('Марафон чтения');
  await page.locator('#g-steps').fill('5');
  await page.locator('#g-save').click();
  assert(await page.locator('#g-error').isVisible(), 'Missing marathon selection must be explained');
  await page.locator('#goal-habit-list input[value="beta-check"]').check();
  await page.locator('#g-save').click();
  assert(await page.evaluate(() => habits.length === 3 && goals.length === 1 && goals[0].habitIds.join() === 'beta-check'), 'Marathon created an extra habit');
  await page.locator('#dock [data-screen="today"]').click();

  // Completion: full screen, chosen marathon moves, and photo is optional.
  await page.locator('[data-check="beta-check"]').click();
  await page.locator('#completion-dialog[open]').waitFor();
  assert((await page.locator('#completion-scenes .w-steps').textContent()).includes('0 → 1'), 'Marathon step not shown');
  const rect = await page.locator('#completion-dialog').boundingBox();
  assert(rect.height >= 840 && rect.width >= 385, 'Completion is not fullscreen');
  await page.screenshot({ path: 'test-results/completion-mobile.png' });
  await page.locator('#completion-dialog [value="share"]').click();
  await page.locator('#proof-skip').click();
  assert(await page.evaluate(() => habits[0].history[TODAY] === true && computeStreak(habits[0]) === 2 && stepsDone(goals[0]) === 1), 'Skip photo changed completion/streak/marathon');

  // Clicking a completed circle cannot silently undo it; Escape keeps it done.
  await page.locator('[data-check="beta-check"]').click();
  await page.locator('#confirm-dialog[open]').waitFor();
  assert(await page.evaluate(() => document.activeElement.value === 'cancel'), 'Destructive action focused by default');
  await page.keyboard.press('Escape');
  assert(await page.locator('[data-check="beta-check"]').getAttribute('aria-pressed') === 'true', 'Escape undid completion');
  await page.locator('[data-check="beta-check"]').click();
  await page.locator('#confirm-dialog [value="cancel"]').click();
  assert(await page.evaluate(() => computeStreak(habits[0]) === 2), 'Cancel lost streak');
  await page.waitForFunction(async () => {
    const response = await fetch('/api/habits', { headers: { Authorization: 'Bearer ' + '1'.repeat(64) } });
    return (await response.json()).find(h => h.id === 'beta-check').history[TODAY] === true;
  });
  await page.reload();
  await page.waitForFunction(() => myLogin === 'beta_tester' && habits.length === 3);
  assert(await page.evaluate(() => computeStreak(habits.find(h => h.id === 'beta-check')) === 2), 'Reload lost streak');

  // Counter follows the same safe completion flow, including confirmed undo.
  await page.locator('[data-check="beta-count"]').click();
  assert(!(await page.locator('#completion-dialog').isVisible()), 'Counter completes too early');
  await page.locator('[data-check="beta-count"]').click();
  await page.locator('#completion-dialog [value="done"]').click();
  await page.locator('[data-check="beta-count"]').click();
  await page.locator('#confirm-dialog [value="cancel"]').click();
  assert(await page.evaluate(() => habits.find(h => h.id === 'beta-count').counts[TODAY] === 2), 'Counter reset on cancellation');
  await page.locator('[data-check="beta-count"]').click();
  await page.locator('#confirm-dialog [value="confirm"]').press('Space', {delay:1100});
  await page.waitForFunction(() => habits.find(h => h.id === 'beta-count').counts[TODAY] === 0);

  // Deletion: keep the underlying details open on cancel, remove on confirmation.
  await page.locator('[data-stats="beta-lock"]').click();
  await page.locator('#hstat-menu-btn').click();
  await page.locator('#hstat-del').click();
  await page.locator('#confirm-dialog [value="cancel"]').click();
  assert(await page.locator('#hstat-overlay').isVisible(), 'Cancel closed details');
  assert(await page.evaluate(() => habits.some(h => h.id === 'beta-lock')), 'Cancel deleted habit');
  await page.locator('#hstat-menu-btn').click();
  await page.locator('#hstat-del').click();
  await page.locator('#confirm-dialog [value="confirm"]').press('Space', {delay:1100});
  await page.waitForFunction(() => !habits.some(h => h.id === 'beta-lock'));

  // Weekly setting is one label, selected color affects the actual card.
  await page.locator('#btn-add').click();
  await page.locator('#create-promise').click();
  assert(await page.locator('[data-stake="lock"]').isDisabled(), 'Unsupported blocker still selectable');
  assert(await page.locator('#wt-hint').count() === 0, 'Verbose weekly text still shown');
  await page.locator('#f-name').fill('Цветное обещание');
  const color = await page.locator('#color-picker [data-color]').nth(2).getAttribute('data-color');
  await page.locator('#color-picker [data-color]').nth(2).click();
  await page.locator('[data-schedule="flex"]').click();
  assert(await page.locator('#day-picker button').first().isDisabled(), 'Flexible schedule retains active fixed days');
  await page.locator('#btn-save').press('Space', {delay:1100});
  await page.waitForFunction(() => habits.some(h => h.name === 'Цветное обещание'));
  const saved = await page.evaluate(() => habits.find(h => h.name === 'Цветное обещание'));
  assert(saved.color === color && saved.weekTarget === 1, 'Settings not saved');
  assert((await page.locator(`[data-hid="${saved.id}"]`).getAttribute('style')).includes(color), 'Card ignores selected color');

  // Friends: empty state -> add real local account -> visible progress.
  await page.locator('#dock [data-screen="friends"]').click();
  await page.waitForFunction(() => !friendsLoading);
  await page.locator('#btn-friend-add').click();
  await page.locator('#fr-login').fill('beta_friend');
  await page.locator('#fr-save').click();
  await page.locator('.friend-card').waitFor();
  assert((await page.locator('.friend-card').textContent()).includes('Серия 12'), 'Friend progress missing');
  await page.screenshot({ path: 'test-results/friends-mobile.png' });

  // Responsive dock: every target stays inside the viewport at all widths.
  for (const width of [320, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await page.locator('#dock .dock-item').evaluateAll(nodes => nodes.map(n => {
      const r = n.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width, height: r.height };
    }));
    assert(bounds.every(r => r.x >= 0 && r.right <= width && r.width >= 44 && r.height >= 44), `Dock overflows at ${width}px`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}px`);
  }
  await page.screenshot({ path: 'test-results/friends-desktop.png' });
  await page.locator('#dock [data-screen="today"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/today-mobile.png' });
  assert(errors.length === 0, 'Browser exceptions: ' + errors.join(', '));
  return { passed: ['marathon', 'completion', 'streak', 'optional proof', 'reload', 'safe undo', 'counter', 'deletion', 'weekly setting', 'colors', 'friends', 'dock at 4 widths'], pageErrors: errors };
}
