// Run after browser-path-ui.js, only against the disposable :3337 fixture.
async page => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.unrouteAll({behavior:'ignoreErrors'});
  await page.route('**/path-*', r => r.continue());
  await page.goto('http://localhost:3337/#marathon'); await page.reload();
  await page.waitForFunction(() => myLogin === 'beta_tester' && habits.length === 4);
  await page.evaluate(() => {
    goals = goals.filter(g => !['Вода каждый день','Вода: мой маршрут','Собрать походный рюкзак'].includes(g.name));
    profile.owned = profile.owned.filter(x => !['gear:helmet','scene:moon'].includes(x));
    profile.gear=''; profile.activeGoal=null; profile.mark=null;
    saveJson(GOALS_KEY,goals); saveJson(PROFILE_KEY,profile); render();
  });
  await page.setViewportSize({width:390,height:844});
  await page.locator('#dock [data-screen="marathon"]').click();
  assert(await page.locator('#walker .path-person').count() === 1, 'Detailed traveler missing');
  assert(await page.locator('#walker .traveler-pack').count() === 1, 'Backpack missing');
  assert(await page.locator('#marathon-linked .journey-habit').count() === 1, 'Linked promises missing');
  const before = await page.evaluate(() => ({habits:habits.length, goals:goals.length, start:goals[0].startedAt}));
  await page.locator('#btn-goal-add').click();
  await page.locator('#g-name').fill('Вода каждый день');
  assert(await page.locator('#goal-habit-list input[value="beta-check"]').isDisabled(), 'Occupied promise selectable');
  await page.locator('#goal-habit-list input[value="beta-count"]').check();
  await page.locator('#g-steps').fill('10');
  assert((await page.locator('#journey-form-summary').textContent()).includes('10 шагов, 1 обещание'), 'Summary stale');
  await page.locator('#g-save').click();
  const second = await page.evaluate(() => goals.find(g => g.name === 'Вода каждый день').id);
  assert(await page.evaluate(b => habits.length === b.habits && goals.length === b.goals + 1, before), 'Creation overwrote route or duplicated promise');
  await page.locator(`[data-gselect="${second}"]`).click();
  assert(await page.locator('#walker .w-goal').textContent() === 'Вода каждый день', 'Selected route not displayed');
  await page.reload(); await page.waitForFunction(id => activeJourney()?.id === id, second);
  await page.locator('#dock [data-screen="marathon"]').click();
  assert(await page.locator('#walker .w-goal').textContent() === 'Вода каждый день', 'Selected route not persisted');
  await page.locator(`[data-gedit="${second}"]`).click();
  await page.locator('#g-name').fill('Вода: мой маршрут'); await page.locator('#g-save').click();
  assert(await page.evaluate(id => goals.find(g => g.id === id).startedAt === TODAY, second), 'Edit reset start');
  await page.locator('#btn-goal-add').click(); await page.locator('#g-name').fill('Собрать походный рюкзак');
  await page.locator('#g-steps').fill('0'); await page.locator('#g-save').click();
  const manual = await page.evaluate(() => goals.find(g => g.name === 'Собрать походный рюкзак').id);
  await page.locator(`[data-gplus="${manual}"]`).click();
  assert(await page.evaluate(id => goals.find(g => g.id === id).progress === 5 && !goals.find(g => g.id === id).habitIds.length, manual), 'Manual goal converted');
  await page.locator(`[data-gedit="${manual}"]`).click();
  assert(await page.locator('#g-steps').inputValue() === '0', 'Editing manual goal changes type');
  await page.locator('#g-save').click();
  const bitBefore = await page.evaluate(() => profile.bit);
  await page.locator('[data-gresult]').first().click();
  await page.keyboard.press('Escape');
  assert(await page.evaluate(bit => profile.bit === bit, bitBefore), 'Result replay awarded bits');
  await page.evaluate(() => scrollTo(0,0));
  await page.screenshot({path:'test-results/journey-marathon.png',fullPage:true});

  // A purchase can only debit once; cancellation and insufficient balance are safe.
  await page.locator('#open-avatar').click();
  await page.evaluate(() => {profile.bit=0; renderAvatar();});
  await page.locator('#gear-picker [data-gear="helmet"]').click();
  assert((await page.locator('#confirm-dialog').textContent()).includes('Не хватает битов'), 'Missing insufficient balance state');
  assert(await page.locator('#confirm-dialog .cosmetic-preview .traveler-art').count() === 1, 'No purchase preview');
  await page.locator('#confirm-dialog [value="cancel"]').click();
  await page.evaluate(() => {profile.bit=400; saveJson(PROFILE_KEY,profile); renderAvatar();});
  await page.locator('#gear-picker [data-gear="helmet"]').click(); await page.locator('#confirm-dialog [value="cancel"]').click();
  assert(await page.evaluate(() => profile.bit === 400 && !isOwned('gear','helmet')), 'Cancel spent bits');
  await page.locator('#gear-picker [data-gear="helmet"]').evaluate(b => {b.click(); b.click();});
  await page.locator('#confirm-dialog [value="confirm"]').press('Space', {delay:1100});
  await page.waitForFunction(() => profile.gear === 'helmet');
  assert(await page.evaluate(() => profile.bit === 340 && profile.owned.filter(x => x === 'gear:helmet').length === 1), 'Double purchase');
  await page.locator('#gear-picker [data-gear="helmet"]').click();
  assert(await page.evaluate(() => profile.bit === 340), 'Owned item charged again');
  await page.locator('#journey-scene-shop [data-scene="moon"]').click();
  await page.locator('#confirm-dialog [value="confirm"]').press('Space', {delay:1100});
  await page.waitForFunction(() => isOwned('scene','moon'));
  assert(await page.evaluate(() => profile.bit === 220), 'Scene price changed');
  await page.screenshot({path:'test-results/journey-equipment.png',fullPage:true});
  await page.locator('#journey-profile-avatar').click(); await page.locator('#choose-traveler-avatar').click();
  await page.locator('#pf-save').click();
  assert(await page.evaluate(() => profile.mark === 'traveler' && profile.gear === 'helmet'), 'Profile avatar changed equipment');
  await page.reload(); await page.waitForFunction(() => myLogin === 'beta_tester' && profile.mark === 'traveler');
  assert(await page.evaluate(() => isOwned('gear','helmet') && isOwned('scene','moon')), 'Ownership lost after reload');

  // Every route has a detailed pose; default equipment respects the scene.
  await page.evaluate(() => {profile.gear=''; saveJson(PROFILE_KEY,profile); switchScreen('avatar');});
  assert(await page.locator('#journey-scene-shop .path-person').count() === 6, 'A scene uses the old stick figure');
  await page.screenshot({path:'test-results/journey-scenes.png',fullPage:true});
  const poses = await page.locator('#journey-scene-shop .path-person').evaluateAll(nodes => nodes.map(n => ({pose:n.classList[1],gear:n.dataset.equipment})));
  assert(poses.some(p=>p.pose==='pose-swim' && p.gear==='goggles') && poses.some(p=>p.pose==='pose-climb' && p.gear==='axe') && poses.some(p=>p.pose==='pose-trudge' && p.gear==='hood'), 'Special equipment not applied');
  const clipped = await page.evaluate(() => SCENES.flatMap(sc => [0,1].map(t => {
    const host=document.createElement('div'); host.innerHTML=journeyScenePreview(sc,`bounds-${sc.id}-${t}`); document.body.append(host);
    const svg=host.querySelector('svg'), person=host.querySelector('.path-person'), p=walkerPath(sc,t);
    person.parentNode.setAttribute('transform',`translate(${p.x} ${p.y})`);
    const b=person.getBoundingClientRect(), s=svg.getBoundingClientRect();
    const bad=b.left<s.left || b.right>s.right || b.top<s.top || b.bottom>s.bottom;
    host.remove(); return bad ? `${sc.id} at ${t}` : null;
  })).filter(Boolean));
  assert(!clipped.length,'Character clipped: '+clipped.join(', '));

  // Fullscreen celebration is dismissible during motion and never rewards replay.
  await page.evaluate(id => {const g=goals.find(g=>g.id===id); showCompletion(habits.find(h=>h.id==='beta-check'),[{g:goals[0],before:0}]);}, second);
  await page.locator('#completion-dialog').waitFor();
  await page.screenshot({path:'test-results/journey-step.png'});
  await page.locator('#completion-dialog [value="done"]').click();
  assert(!(await page.locator('#completion-dialog').isVisible()), 'Completion exit blocked by animation');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(() => showCompletion(habits[0],[{g:goals[0],before:0}]));
  assert(await page.locator('#completion-scenes .w-walker').evaluate(el=>el.getAnimations({subtree:true}).length) === 0, 'Reduced motion still moving');
  await page.keyboard.press('Escape'); await page.emulateMedia({reducedMotion:'no-preference'});

  await page.locator('#dock [data-screen="friends"]').click(); await page.waitForFunction(()=>!friendsLoading);
  await page.evaluate(() => {habits[0].buddy='beta_friend'; save(); renderFriends();});
  await page.locator('.friend-shared summary').click();
  await page.locator('[data-shared-habit]').first().click();
  assert(await page.locator('#hstat-overlay').isVisible(), 'Shared promise not reachable');
  await page.keyboard.press('Escape');
  await page.route('**/api/friends/beta_friend',r=>r.fulfill({status:503,json:{error:'Тест: нет связи'}}));
  await page.locator('[data-fdel="beta_friend"]').click(); await page.locator('#confirm-dialog [value="confirm"]').press('Space', {delay:1100});
  await page.waitForFunction(()=>!document.querySelector('[data-fdel="beta_friend"]').disabled);
  assert(await page.locator('.friend-card').count()===1, 'Failed removal lost friend');
  await page.unroute('**/api/friends/beta_friend');
  await page.evaluate(()=>{serverFriends[0].streak=null; serverFriends[0].weekPct=null; renderFriends(); renderFriendsBoard();});
  assert((await page.locator('.friend-metrics').textContent()).includes('Нет данных'), 'Missing metrics invented');
  await page.screenshot({path:'test-results/journey-friends.png',fullPage:true});
  for(const width of [320,390,430,1440]) {
    await page.setViewportSize({width,height:900});
    for(const tab of ['marathon','avatar','friends']) {
      await page.evaluate(tab=>switchScreen(tab),tab);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), `Overflow ${tab} at ${width}`);
    }
  }
  assert(!errors.length,'Page errors: '+errors.join(', '));
  return {passed:['multiple routes','occupied promise','selected route persistence','manual goal','summary replay','detailed character','purchase preview','insufficient bits','cancel purchase','single debit','scene purchase','ownership persistence','independent profile avatar','six poses','interruptible completion','reduced motion','shared promise details','failed friend removal','missing metrics','four viewports'],errors};
}
