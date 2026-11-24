// A money promise without accepted terms must say plainly that nothing is held
// (tests/money-live-fixture.mjs on :3421; the payment provider is never contacted).
async page => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://localhost:3421/');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('disbit_intro_v1', '1');
    localStorage.setItem('disbit_token_v1', '1'.repeat(64)); localStorage.setItem('disbit_owner_v1', 'payer');
    localStorage.setItem('disbit_auth_user_v1', JSON.stringify({ id: 1, login: 'payer', emailVerified: true })); });
  await page.goto('http://localhost:3421/?account=1');
  await page.waitForFunction(() => wallet?.payments?.live === true && habits.some(h => h.id === 'run'));
  await page.evaluate(() => openHabitStats('run'));
  await page.waitForSelector('#hstat-overlay .money-off');
  const result = {};
  result.saysNotHeld = (await page.textContent('#hstat-overlay .money-off')).includes('Деньги не удерживаются');
  await page.click('[data-money-on="run"]');
  await page.waitForFunction(() => !document.getElementById('add-overlay').hidden);
  result.cardClosed = await page.evaluate(() => document.getElementById('hstat-overlay').hidden);
  result.consentShown = await page.evaluate(() => !document.getElementById('money-terms').hidden && !document.getElementById('f-money-accept').disabled);
  // accept the condition through the form, as a person would
  await page.check('#f-money-accept');
  await page.evaluate(() => submitHabit());   // the real button needs a press-and-hold
  await page.waitForFunction(() => (wallet?.terms || []).some(t => t.habitId === 'run'), null, { timeout: 8000 });
  await page.evaluate(() => openHabitStats('run'));
  await page.waitForTimeout(400);
  result.showsAccepted = await page.evaluate(() => !document.querySelector('#hstat-overlay .money-off')
    && document.getElementById('hstat-body').textContent.includes('из депозита за невыполненный день'));
  if (Object.values(result).some(v => !v) || errors.length) throw Error(JSON.stringify({ result, errors }));
  return result;
}
