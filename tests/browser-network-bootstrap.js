// Run against the isolated localhost fixture; the artificial delay is intentional.
async page => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:3399/');
  await page.evaluate(() => {
    localStorage.setItem('disbit_token_v1', 'a'.repeat(64));
    localStorage.setItem('disbit_owner_v1', 'tester');
    localStorage.setItem('disbit_intro_v1', '1');
  });
  const events = [];
  page.on('request', request => {
    if (request.url().includes('/api/')) events.push({ path: request.url().split('/api/')[1].split('?')[0], at: Date.now() });
  });
  await page.route('**/api/habits?includeArchived=1', route => route.fulfill({ json: [{
    id: 'bootstrap-check', name: 'Проверка загрузки', createdAt: '2026-01-01', schedule: [0,1,2,3,4,5,6],
    goal: { type: 'check' }, stake: { mode: 'money', amount: 100 }, history: {}, counts: {}
  }] }));
  await page.route('**/api/wallet', async route => { await page.waitForTimeout(2000); await route.continue(); });
  const start = Date.now();
  await page.reload();
  await page.waitForFunction(() => habits.some(h => h.id === 'bootstrap-check') && supportSyncBusy);
  const early = Date.now() - start;
  if (early >= 1900) throw new Error(`Habits waited for the delayed wallet: ${early}ms`);
  await page.waitForFunction(() => !supportSyncBusy && wallet?.sandbox?.available);
  const first = name => events.find(e => e.path === name)?.at;
  const auth = first('auth/me'), habit = first('habits'), charge = first('charges'), state = first('state'), friends = first('friends'), walletAt = first('wallet');
  if (!auth || !habit || !charge || !state || !friends || !walletAt) throw new Error('Missing expected bootstrap request');
  if (Math.max(habit, charge, state, friends, walletAt) - Math.min(habit, charge, state, friends, walletAt) > 800) throw new Error('Independent reads were not started together');
  if (errors.length) throw new Error(errors.join(' | '));
  return { habitsVisibleMs: early, walletDelayMs: 2000, parallelReads: true, browserErrors: errors.length };
}
