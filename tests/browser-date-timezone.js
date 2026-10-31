// Uses isolated browser contexts and a local synthetic server only.
async page => {
  const results = [];
  for (const zone of ['Europe/Moscow', 'America/Los_Angeles']) {
    const context = await page.context().browser().newContext({timezoneId: zone});
    const tab = await context.newPage();
    const errors=[]; tab.on('pageerror', e=>errors.push(e.message));
    try {
      await tab.goto('http://127.0.0.1:3399/');
      const value=await tab.evaluate(() => {
        const days=['2024-02-29','2024-12-31','2025-01-01','2025-01-05'];
        return {zone:clientTimeZone, matches:days.every(day=>formatDay(day)===keyToDate(day).toLocaleDateString('ru-RU',{weekday:'short',day:'numeric',month:'long'}))};
      });
      if(value.zone!==zone || !value.matches || errors.length) throw Error(JSON.stringify({zone,value,errors}));
      results.push(value);
    } finally { await context.close(); }
  }
  return {ok:true,results};
}
