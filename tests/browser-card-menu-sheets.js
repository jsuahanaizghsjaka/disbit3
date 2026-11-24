// Sheets opened from the promise card menu must appear above the card (local fixture only).
async page => {
  const base = 'http://localhost:3337';
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.evaluate(() => {
    localStorage.setItem('disbit_token_v1', '1'.repeat(64)); localStorage.setItem('disbit_owner_v1', 'beta_tester');
    localStorage.setItem('disbit_auth_user_v1', JSON.stringify({ id: 1, login: 'beta_tester', emailVerified: true }));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/');
  await page.waitForFunction(() => typeof habits !== 'undefined' && habits.some(h => h.id === 'beta-check'), null, { timeout: 8000 });
  await page.evaluate(() => document.querySelectorAll('.sheet-overlay:not([hidden])').forEach(o => closeSheet(o.id)));

  // the sheet must be painted above every other open sheet: higher z-index,
  // or the same z-index and later in the markup
  const onTop = id => page.evaluate(id => {
    const ov = document.getElementById(id);
    if (ov.hidden) return false;
    const z = o => Number(getComputedStyle(o).zIndex) || 0;
    return [...document.querySelectorAll('.sheet-overlay:not([hidden])')].filter(o => o !== ov).every(o =>
      z(ov) > z(o) || (z(ov) === z(o) && (o.compareDocumentPosition(ov) & Node.DOCUMENT_POSITION_FOLLOWING)));
  }, id);
  const fromMenu = async (item, overlay) => {
    await page.evaluate(() => openHabitStats('beta-check'));
    await page.click('#hstat-menu-btn');
    await page.click('#' + item);
    await page.waitForTimeout(500);
    const top = await onTop(overlay);
    await page.screenshot({ path: `test-results/card-menu-${item}.png` });
    await page.evaluate(() => document.querySelectorAll('.sheet-overlay:not([hidden])').forEach(o => closeSheet(o.id)));
    await page.waitForTimeout(300);
    return top;
  };

  const result = {};
  result.inviteOnTop = await fromMenu('hstat-invite', 'invite-overlay');
  result.buddyOnTop = await fromMenu('hstat-buddy', 'buddy-overlay');

  // closing the invite returns to the card, which is still open underneath
  await page.evaluate(() => openHabitStats('beta-check'));
  await page.click('#hstat-menu-btn');
  await page.click('#hstat-invite');
  await page.waitForTimeout(400);
  await page.click('#invite-close');
  await page.waitForTimeout(400);
  result.cardBackAfterClose = await onTop('hstat-overlay');

  if (Object.values(result).some(v => !v) || errors.length) throw Error(JSON.stringify({ result, errors }));
  return result;
}
