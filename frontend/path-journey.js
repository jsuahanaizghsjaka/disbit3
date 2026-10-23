/* Visual spec 11–15. Progress and purchases still use the existing product rules. */
function activeJourney() {
  return goals.find(g => g.id === profile.activeGoal && isMarathon(g))
    || goals.find(g => isMarathon(g) && goalPct(g) < 100) || goals.find(isMarathon);
}
function chooseJourney(id) {
  profile.activeGoal = id; saveJson(PROFILE_KEY, profile); render();
  document.getElementById('marathon-walker-slot').scrollIntoView({ block: 'start' });
}
function journeyScenePreview(sc, uid = 'preview') {
  const p = walkerPath(sc, .45);
  return `<svg viewBox="0 0 320 132" role="img" aria-label="${escapeHtml(sc.name)}: путешественник на маршруте">
    <defs><linearGradient id="${uid}" x2="0" y2="1"><stop stop-color="${sc.sky[0]}"/><stop offset="1" stop-color="${sc.sky[2]}"/></linearGradient></defs>
    <rect width="320" height="132" fill="url(#${uid})"/>${walkerSky(sc)}${walkerTerrain(sc)}${walkerFinish(sc)}
    <g transform="translate(${p.x} ${p.y})">${walkerFigure(sc)}</g></svg>`;
}
function renderJourneyLinks() {
  const box = document.getElementById('marathon-linked'), g = activeJourney();
  if (!g) { box.innerHTML = ''; return; }
  box.innerHTML = `<p class="journey-deadline">${g.deadline ? `До ${escapeHtml(formatDay(g.deadline))}` : 'В своём темпе, без срока'} · ${escapeHtml(sceneOf(g).name)}</p>
    <h2 class="section-title">Шаги сегодня</h2>` + marathonHabits(g).map(h => `<button class="journey-habit" data-journey-habit="${h.id}">
    <span class="habit-icon" style="--habit-color:${safeColor(h.color)}">${iconOf(h.icon)}</span><span><b>${escapeHtml(h.name)}</b><small>${isDoneToday(h) ? 'Выполнено' : isSkipOn(h, TODAY) ? 'Пропуск, серия сохранена' : !isScheduledOn(h, new Date()) ? 'Не сегодня' : 'Ждёт твоего шага'}</small></span>${icon(isDoneToday(h) ? 'i-check' : 'i-chev-r')}</button>`).join('');
  if (!marathonHabits(g).length) box.innerHTML += '<p class="hint">Связанные обещания удалены. Выбери другие в настройках маршрута.</p>';
  box.querySelectorAll('[data-journey-habit]').forEach(b => b.onclick = () => openHabitStats(b.dataset.journeyHabit));
}
function updateJourneyForm() {
  syncJourneyWheels();
  const steps = Number(document.getElementById('g-steps').value) || 0;
  const sc = sceneOf({ scene: document.querySelector('#goal-scene-picker .selected')?.dataset.scene });
  const box = document.getElementById('journey-form-summary');
  if (!box) return;
  box.textContent = steps > 0
    ? `${document.getElementById('g-name').value.trim() || 'Марафон'}: ${steps} ${plural(steps, 'шаг', 'шага', 'шагов')}, ${checkedMarathonHabits().length} ${plural(checkedMarathonHabits().length, 'обещание', 'обещания', 'обещаний')}. Сцена: ${sc.name}. Новые обещания и штрафы не создаются.`
    : 'Ручная цель: прогресс меняешь сам кнопками −5% и +5%. Путешественник и обещания не привязываются.';
}
function renderTravelerPreview() {
  const box = document.getElementById('traveler-preview');
  box.innerHTML = `<div class="traveler-studio"><svg viewBox="0 0 220 300" role="img" aria-label="Твой путешественник с выбранным снаряжением">${pathTravelerArtwork(profile.gear || 'hat')}</svg><div><span class="journey-eyebrow">Твой спутник</span><h2>Готов к пути</h2><p>Один персонаж.<br>Все твои маршруты.</p></div></div>`;
}
function cosmeticPreview(kind, id) {
  if (kind === 'gear') return `<svg viewBox="0 0 220 300" aria-hidden="true">${pathTravelerArtwork(id || 'hat')}</svg>`;
  if (kind === 'scene') return journeyScenePreview(sceneOf({ scene: id }), 'purchase-sky');
  if (kind === 'mark') return `<img src="${markSrc(id)}" width="96" height="96" alt=""/>`;
  if (kind === 'icon') return iconOf(id);
  if (kind === 'theme') return `<span class="purchase-swatch" style="background:${THEMES.find(t => t.id === id)?.c || '#4E78FF'}"></span>`;
  return icon('i-heart');
}
function friendMetric(value, suffix = '') {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? 'Нет данных' : `${Number(value)}${suffix}`;
}
function wireJourneyUI() {
  const form = document.getElementById('goal-overlay');
  const summary = document.createElement('p'); summary.id = 'journey-form-summary'; summary.className = 'form-summary';
  form.querySelector('.sheet-actions').before(summary);
  form.addEventListener('input', updateJourneyForm);
  form.addEventListener('change', updateJourneyForm);
  form.querySelectorAll('input').forEach(el => { el.name = el.id; el.autocomplete = 'off'; });
  document.getElementById('journey-profile-avatar').onclick = openProfileSheet;
  document.getElementById('choose-traveler-avatar').onclick = () => {
    avaDraft.mark = 'traveler'; avaDraft.photo = null; avaDraft.emoji = null;
    updateAvaPreview(); buildMarkPicker();
  };
  // A prominent action precedes the list; existing handler and invitation model stay intact.
  const addFriend = document.getElementById('btn-friend-add');
  addFriend.classList.add('btn-primary'); addFriend.parentElement.querySelector('#friend-list').before(addFriend);
  const equipment = document.getElementById('gear-picker').closest('section');
  document.getElementById('theme-grid').closest('section').before(equipment);
}
