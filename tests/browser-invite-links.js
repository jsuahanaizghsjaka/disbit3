// Invite links opened by a guest must survive sign-in (local fixture only).
async page => {
  const base = 'http://localhost:3337';
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const signIn = (id, login) => page.evaluate(([id, login]) => {
    localStorage.setItem('disbit_token_v1', String(id).repeat(64)); localStorage.setItem('disbit_owner_v1', login);
    localStorage.setItem('disbit_auth_user_v1', JSON.stringify({ id, login, emailVerified: true }));
  }, [id, login]);
  const api = (id, method, url, body) => page.evaluate(async ([id, method, url, body]) => {
    const r = await fetch('/api' + url, { method, headers: { Authorization: 'Bearer ' + String(id).repeat(64), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return r.json();
  }, [id, method, url, body]);
  const result = {};

  // 1) ?add= as a guest: remembered and the address is cleaned
  await page.goto(base + '/?add=beta_tester');
  await page.waitForTimeout(800);
  result.addCleaned = !new URL(page.url()).searchParams.has('add');
  result.addRemembered = await page.evaluate(() => JSON.parse(localStorage.getItem('disbit_pending_add_v1') || '{}').login === 'beta_tester');
  // the friend signs in (reload = what happens after a Google redirect)
  await signIn(2, 'beta_friend');
  await page.goto(base + '/');
  await page.waitForFunction(() => !localStorage.getItem('disbit_pending_add_v1'), null, { timeout: 8000 });
  await page.waitForTimeout(800);
  const incoming = await api(1, 'GET', '/friends');
  result.requestSent = (incoming.incoming || []).some(f => f.login === 'beta_friend') || (incoming.friends || []).some(f => f.login === 'beta_friend');

  // 2) ?join= as a guest: the invite opens after sign-in
  const invite = await api(1, 'POST', '/invites', { habitId: 'beta-check' });
  if (!invite.code) throw Error('invite not created: ' + JSON.stringify(invite));
  await page.evaluate(() => { localStorage.removeItem('disbit_token_v1'); localStorage.removeItem('disbit_auth_user_v1'); localStorage.removeItem('disbit_owner_v1'); });
  await page.goto(base + '/?join=' + invite.code);
  await page.waitForTimeout(800);
  result.joinCleaned = !new URL(page.url()).searchParams.has('join');
  result.joinRemembered = await page.evaluate(code => localStorage.getItem('disbit_pending_join_v1') === code, invite.code);
  await signIn(2, 'beta_friend');
  await page.goto(base + '/');
  await page.waitForFunction(() => !document.getElementById('join-overlay').hidden, null, { timeout: 8000 });
  result.joinSheet = (await page.textContent('#join-who')).includes('beta_tester');

  // 2b) accepting links both promises; a stale owner save must not unlink them
  const accepted = await api(2, 'POST', '/invites/' + invite.code + '/accept');
  const ownerHabit = () => api(1, 'GET', '/habits').then(list => list.find(h => h.id === 'beta-check'));
  result.linked = accepted.ok === true && (await ownerHabit()).buddy === 'beta_friend';
  const stale = { ...(await ownerHabit()), buddy: '', pinned: true };
  await api(1, 'PUT', '/habits/beta-check', stale);
  result.staleSaveKeepsBuddy = (await ownerHabit()).buddy === 'beta_friend';
  await api(1, 'PUT', '/habits/beta-check', { ...stale, buddyChange: true });
  result.explicitUnlink = (await ownerHabit()).buddy === '';

  // 3) personal link with the inviter's token: friendship without a request
  const owner = await api(1, 'GET', '/friends');
  if (!owner.inviteToken) throw Error('no invite token');
  const wrong = await api(7, 'POST', '/friends', { login: 'beta_tester', token: 'x'.repeat(owner.inviteToken.length) });
  result.wrongTokenOnlyRequests = wrong.pending === true;
  await page.evaluate(() => { localStorage.removeItem('disbit_token_v1'); localStorage.removeItem('disbit_auth_user_v1'); localStorage.removeItem('disbit_owner_v1'); });
  await page.goto(base + '/invite?add=beta_tester&t=' + owner.inviteToken);   // server redirects to /?add=…&t=…
  await page.waitForTimeout(800);
  result.tokenCleaned = !new URL(page.url()).searchParams.has('t');
  await signIn(3, 'skip_buyer');
  await page.goto(base + '/');
  await page.waitForFunction(() => !localStorage.getItem('disbit_pending_add_v1'), null, { timeout: 8000 });
  await page.waitForTimeout(800);
  result.tokenFriends = (await api(1, 'GET', '/friends')).friends.some(f => f.login === 'skip_buyer');
  result.linkFormat = await page.evaluate(() => { return inviteLink().startsWith('https://disbit.ru/invite?add=skip_buyer&t='); });

  // 3b) link preview for messengers: personal title, escaped, image
  const preview = await page.evaluate(async () => (await fetch('/invite?add=beta_tester&t=x')).text());
  result.previewTitle = preview.includes('<meta property="og:title" content="@beta_tester зовёт тебя в Disbit">') && preview.includes('/og.png');
  const hostile = await page.evaluate(async () => (await fetch('/invite?add=%22%3E%3Cscript%3E')).text());
  result.previewEscaped = !hostile.includes('"><script>');

  // 4) App Links file
  const links = await page.evaluate(async () => (await fetch('/.well-known/assetlinks.json')).json());
  result.assetLinks = links[0]?.target?.package_name === 'io.disbit.app'
    && links[0].target.sha256_cert_fingerprints[0] === '7E:95:AD:23:AD:CC:F1:96:A5:4A:A7:3A:B1:A1:92:F9:7A:1F:54:C6:99:D6:93:28:02:94:5E:54:4B:EF:D7:01';

  if (Object.values(result).some(v => !v) || errors.length) throw Error(JSON.stringify({ result, errors }));
  return result;
}
