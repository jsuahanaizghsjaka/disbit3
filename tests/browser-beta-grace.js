// Run after browser-beta-edge.js.
async page => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  await page.reload();
  await page.waitForFunction(() => myLogin === 'beta_tester' && habits.length === 3);
  await page.locator('#dock [data-screen="today"]').click();
  await page.locator('[data-check="beta-count"]').click();
  await page.locator('#confirm-dialog [value="confirm"]').press('Space', {delay:1100});
  await page.waitForFunction(() => !isDoneToday(habits.find(h => h.id === 'beta-count')));
  const before = await page.evaluate(() => ({ left: skipsLeft(), streak: computeStreak(habits.find(h => h.id === 'beta-count')), bit: profile.bit }));
  await page.locator('[data-stats="beta-count"]').click();
  await page.locator('#hstat-menu-btn').click();
  await page.locator('#hstat-skip').click();
  await page.locator('#confirm-dialog [value="cancel"]').click();
  assert(await page.evaluate(left => skipsLeft() === left, before.left), 'Cancelled grace spent a day');
  await page.locator('#hstat-menu-btn').click();
  await page.locator('#hstat-skip').click();
  await page.locator('#confirm-dialog [value="confirm"]').press('Space', {delay:1100});
  await page.waitForFunction(() => isSkipOn(habits.find(h => h.id === 'beta-count'), TODAY));
  assert(await page.evaluate(before => {
    const h = habits.find(h => h.id === 'beta-count');
    return !isDoneToday(h) && computeStreak(h) === before.streak && skipsLeft() === before.left - 1 && profile.bit === before.bit;
  }, before), 'Grace changed streak, granted a bit, or spent wrong quota');
  assert(await page.locator('#hstat-skip').isDisabled(), 'Can spend grace twice');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForFunction(() => habits.some(h => h.id === 'beta-count' && isSkipOn(h, TODAY)));
  assert(await page.evaluate(streak => computeStreak(habits.find(h => h.id === 'beta-count')) === streak, before.streak), 'Grace streak lost after reload');

  // Finish a marathon by real completion, not by changing its existing progress.
  await page.locator('[data-check="beta-check"]').click();
  await page.locator('#confirm-dialog [value="confirm"]').press('Space', {delay:1100});
  await page.waitForFunction(() => !isDoneToday(habits.find(h => h.id === 'beta-check')));
  await page.locator('#dock [data-screen="marathon"]').click();
  await page.locator('[data-gedit]').first().click();
  await page.locator('#g-steps').fill('1');
  await page.locator('#g-save').click();
  assert(await page.evaluate(() => habits.length === 3 && goals.length === 1), 'Editing marathon created a duplicate');
  await page.locator('#dock [data-screen="today"]').click();
  await page.locator('[data-check="beta-check"]').click();
  await page.locator('#completion-dialog[open]').waitFor();
  assert((await page.locator('#completion-scenes .w-left').textContent()) === 'Финиш!', 'Final step not shown');
  await page.locator('#completion-summary').click();
  await page.locator('#mdone-overlay').waitFor();
  await page.locator('#mdone-close').click();
  assert(await page.evaluate(() => !walkerFrozen && goals[0].doneShown && goalPct(goals[0]) === 100), 'Finish left a frozen or incomplete marathon');
  await page.locator('#dock [data-screen="friends"]').click();
  await page.waitForFunction(() => !friendsLoading);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.screenshot({ path: 'test-results/friends-320.png', fullPage: true });
  return { passed: ['cancel grace', 'neutral streak on grace', 'quota consumed once', 'no free bit', 'grace persists', 'marathon edit without duplicate', 'marathon finish'] };
}
