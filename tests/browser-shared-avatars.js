// Shared promise: real avatars of both people, avatar changes reach the card,
// shared progress in the promise card and on the Friends tab (local fixture only).
async page => {
  const base = 'http://localhost:3337';
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const api = (id, method, url, body) => page.evaluate(async ([id, method, url, body]) => {
    const r = await fetch('/api' + url, { method, headers: { Authorization: 'Bearer ' + String(id).repeat(64), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return r.json();
  }, [id, method, url, body]);
  // a tiny real image: a 2×2 canvas in one colour, as a JPEG data URL
  const photo = colour => page.evaluate(c => { const cv = document.createElement('canvas'); cv.width = cv.height = 2;
    const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 2, 2); return cv.toDataURL('image/jpeg', 0.9); }, colour);
  // the friend publishes a profile and the progress of the shared promise
  const publish = async (data) => {
    const cur = await api(2, 'GET', '/state');
    const r = await api(2, 'PUT', '/state', { data: { ...(cur.data || {}), ...data }, ts: Date.now(), baseUpdatedAt: cur.updatedAt });
    if (!r.ok) throw Error('state not saved: ' + JSON.stringify(r));
  };
  const key = 'читать каждый день';
  const stats = { today: true, week: 3, weekGoal: 7, streak: 4, pct30: 80, last7: [false, true, true, null, true, true, true] };
  const result = {};

  await page.evaluate(() => {
    localStorage.setItem('disbit_token_v1', '1'.repeat(64)); localStorage.setItem('disbit_owner_v1', 'beta_tester');
    localStorage.setItem('disbit_auth_user_v1', JSON.stringify({ id: 1, login: 'beta_tester', emailVerified: true }));
  });
  await page.goto(base + '/');
  // 1) link the promise through an invite: user 2 gets the same promise and the friendship
  const invite = await api(1, 'POST', '/invites', { habitId: 'beta-check' });
  const accepted = await api(2, 'POST', '/invites/' + invite.code + '/accept');
  if (!accepted.ok) throw Error('invite not accepted: ' + JSON.stringify(accepted));
  const red = await photo('#e11d48'), blue = await photo('#2563eb');
  await publish({ profile: { name: 'Катя', photo: red, color: '#22C55E' }, card: { streak: 4, weekPct: 57, habits: 1, shared: { [key]: true }, sharedStats: { [key]: stats } } });

  // 2) the API sends the photo and progress, and drops anything that is not an image
  const friend = (await api(1, 'GET', '/friends')).friends.find(f => f.login === 'beta_friend');
  result.apiPhoto = friend?.photo === red;
  result.apiStats = friend?.sharedStats?.[key]?.week === 3 && friend.sharedStats[key].last7.length === 7;
  await publish({ profile: { name: 'Катя', photo: 'javascript:alert(1)', mark: '"><img src=x>' } });
  const hostile = (await api(1, 'GET', '/friends')).friends.find(f => f.login === 'beta_friend');
  result.apiRejectsBadAvatar = hostile.photo === null && hostile.mark === null;
  await publish({ profile: { name: 'Катя', photo: red, color: '#22C55E' } });

  // 3) the card shows two real, larger avatars; the friend did it today
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.habit[data-hid="beta-check"] .pair-ava').length === 2, null, { timeout: 8000 });
  const pair = () => page.evaluate(() => [...document.querySelectorAll('.habit[data-hid="beta-check"] .pair-ava')].map(a => ({
    src: a.querySelector('img')?.getAttribute('src') || '', size: Math.round(a.getBoundingClientRect().width), lit: a.classList.contains('lit') })));
  let p = await pair();
  result.friendPhotoOnCard = p[1].src === red;
  result.biggerAvatars = p.every(a => a.size >= 34);
  result.friendLit = p[1].lit === true;
  await page.locator('.habit[data-hid="beta-check"]').screenshot({ path: 'test-results/shared-avatars-card.png' });

  // 4) the friend changes the photo — the card picks it up on the next friends load
  await publish({ profile: { name: 'Катя', photo: blue, color: '#22C55E' } });
  await page.evaluate(() => loadFriends(true));
  await page.waitForFunction(b => document.querySelector('.habit[data-hid="beta-check"] .pair-ava:nth-child(2) img')?.getAttribute('src') === b, blue, { timeout: 8000 });
  result.friendPhotoUpdates = true;

  // 5) I change my own avatar — my side of the card updates without a reload
  const mine = await photo('#f59e0b');
  await page.evaluate(src => { openProfileSheet(); avaDraft.photo = src; avaDraft.emoji = null; avaDraft.mark = null; saveProfile(); }, mine);
  p = await pair();
  result.myPhotoUpdates = p[0].src === mine;

  // 6) the promise card: "together" block with both people and the shared progress
  await page.evaluate(() => openHabitStats('beta-check'));
  await page.waitForTimeout(300);
  const duo = await page.evaluate(() => {
    const d = document.querySelector('#hstat-body .duo');
    return d && { people: d.querySelectorAll('.duo-person').length, text: d.textContent.replace(/\s+/g, ' '),
      photos: [...d.querySelectorAll('.duo-ava img')].map(i => i.getAttribute('src')), dots: d.querySelectorAll('.duo-dots').length };
  });
  result.duoBlock = !!duo && duo.people === 2 && duo.dots === 2;
  result.duoPhotos = !!duo && duo.photos[0] === mine && duo.photos[1] === blue;
  result.duoFriendWeek = !!duo && duo.text.includes('Неделя 3 из 7') && duo.text.includes('серия 4');
  result.duoBoth = !!duo && /Оба выполнили \d из 7/.test(duo.text);
  result.duoOverall = !!duo && duo.text.includes('неделя 57%');
  await page.locator('#hstat-overlay .sheet').screenshot({ path: 'test-results/shared-avatars-detail.png' });
  await page.evaluate(() => closeSheet('hstat-overlay'));

  // 7) Friends tab: real avatar, pair progress for the week and per-promise progress
  await page.evaluate(() => switchScreen('friends'));
  await page.waitForFunction(() => document.querySelector('.friend-card .duo-total'), null, { timeout: 8000 });
  const tab = await page.evaluate(() => {
    const c = document.querySelector('.friend-card');
    return { photo: c.querySelector('.friend-ava img')?.getAttribute('src'), total: c.querySelector('.duo-total')?.textContent.replace(/\s+/g, ' '),
      row: c.querySelector('.duo-row small')?.textContent.replace(/\s+/g, ' '),
      board: [...document.querySelectorAll('#friends-board .friend-ava img')].map(i => i.getAttribute('src')) };
  });
  result.friendsTabPhoto = tab.photo === blue;
  result.friendsTabTotal = /Вместе на этой неделе: \d+ из \d+ отметок/.test(tab.total || '');
  result.friendsTabRow = /Ты \d\/\d.*Катя 3\/7 ✓/.test(tab.row || '');
  result.boardPhotos = tab.board.includes(blue) && tab.board.includes(mine);
  await page.locator('.friend-card').first().screenshot({ path: 'test-results/shared-avatars-friends.png' });

  if (Object.values(result).some(v => !v) || errors.length) throw Error(JSON.stringify({ result, errors }));
  return result;
}
