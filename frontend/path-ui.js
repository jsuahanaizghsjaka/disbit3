/* Presentation and navigation for visual spec 1–10. Business state stays in script.js. */
const pathScroll = new Map();
const pathSheetFocus = new Map();
const habitDrafts = new Map();
let habitFormSaving = false;
const pendingHabitMarks = new Set();
const habitMarkErrors = new Map();
function habitDraftStorageKey(key) { return `disbit-path-draft:${localStorage.getItem(OWNER_KEY) || 'local'}:${key}`; }
function discardHabitDraft(key) {
  habitDrafts.delete(key);
  try { sessionStorage.removeItem(habitDraftStorageKey(key)); } catch {}
}

function rememberHabitDraft() {
  if (habitFormSaving) return;
  habitDrafts.set(editingId || 'new', {
    values: Object.fromEntries([...document.querySelectorAll('#add-overlay input')].map(el => [el.id, el.value])),
    icon: document.querySelector('#icon-picker .selected')?.dataset.icon,
    color: document.querySelector('#color-picker .selected')?.dataset.color,
    days: selectedDays(), weekTarget: wtValue,
    goal: segValue('goal-type', 'goal'), stake: segValue('stake-mode', 'stake'), recipient: segValue('recipient', 'rec'),
  });
  try { sessionStorage.setItem(habitDraftStorageKey(editingId || 'new'), JSON.stringify(habitDrafts.get(editingId || 'new'))); } catch {}
}

function restoreHabitDraft(key) {
  let draft = habitDrafts.get(key);
  try { draft ||= JSON.parse(sessionStorage.getItem(habitDraftStorageKey(key))); } catch {}
  if (!draft) return;
  for (const [id, value] of Object.entries(draft.values)) document.getElementById(id).value = value;
  setPickSelected('icon-picker', 'icon', draft.icon);
  setPickSelected('color-picker', 'color', draft.color);
  buildDayPicker(draft.days);
  setWeekTarget(draft.weekTarget, false);
  setSegActive('goal-type', 'goal', draft.goal);
  setSegActive('stake-mode', 'stake', draft.stake);
  setSegActive('recipient', 'rec', draft.recipient);
  document.getElementById('count-fields').hidden = draft.goal !== 'count';
  document.getElementById('stake-money').hidden = draft.stake !== 'money';
  document.getElementById('stake-lock').hidden = draft.stake === 'money';
}

function updateHabitForm() {
  const name = document.getElementById('f-name').value.trim();
  const selectedIcon = document.querySelector('#icon-picker .selected')?.dataset.icon || HABIT_ICONS[0];
  const color = safeColor(document.querySelector('#color-picker .selected')?.dataset.color);
  const preview = document.getElementById('habit-preview');
  const schedule = wtValue ? `${wtValue} ${plural(wtValue, 'день', 'дня', 'дней')} в неделю`
    : selectedDays().length === 7 ? 'Каждый день' : selectedDays().map(i => DAY_NAMES[i]).join(', ') || 'Выбери дни';
  preview.style.setProperty('--habit-color', color);
  preview.innerHTML = `<span class="habit-icon">${iconOf(selectedIcon)}</span><div><b>${escapeHtml(name || 'Моё обещание')}</b><small>${schedule}</small></div>`;
  const limit = document.getElementById('name-limit');
  limit.hidden = name.length < 30;
  limit.textContent = `${name.length} из 40 символов`;
  const count = segValue('goal-type', 'goal') === 'count'
    ? `Цель: ${document.getElementById('f-target').value} ${document.getElementById('f-unit').value.trim()}. ` : '';
  const money = segValue('stake-mode', 'stake') === 'money';
  document.getElementById('habit-summary').textContent = `${name || 'Новое обещание'}. ${schedule}. ${count}` +
    (money ? `${document.getElementById('f-amount').value || 0} ₽ за невыполнение, ${segValue('recipient', 'rec') === 'charity' ? 'на благотворительность' : 'создателям'}.` : 'Старая блокировка недоступна. Денежный штраф не включён.');
  document.querySelectorAll('#schedule-mode button').forEach(b => {
    const active = (b.dataset.schedule === 'flex') === (wtValue > 0);
    b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active));
  });
  document.getElementById('day-picker').hidden = wtValue > 0;
  document.getElementById('fixed-days-label').hidden = wtValue > 0;
  document.getElementById('wt-card').hidden = wtValue === 0;
  document.querySelectorAll('#add-overlay .seg-btn, #add-overlay .pick').forEach(b =>
    b.setAttribute('aria-pressed', String(b.classList.contains('active') || b.classList.contains('selected'))));
}

function habitFormError(message, fieldId) {
  const box = document.getElementById('habit-form-error');
  box.textContent = message; box.hidden = false;
  const field = document.getElementById(fieldId);
  if (field) { field.setAttribute('aria-invalid', 'true'); field.setAttribute('aria-describedby', 'habit-form-error'); (field.matches('input') ? field : field.querySelector('button'))?.focus(); }
  box.scrollIntoView({ block: 'nearest' });
}

function updatePathDetails(h) {
  document.getElementById('detail-archive').textContent = h.archived ? 'Восстановить из архива' : 'В архив';
  ['hstat-edit','hstat-minimum','detail-undo'].forEach(id => { document.getElementById(id).disabled = !!h.archived; });
  if (h.archived) document.getElementById('hstat-skip').disabled = true;
  const root = document.getElementById('hstat-body');
  const status = isSkipOn(h, TODAY) ? 'Пропуск · серия сохранена' : isMinOn(h, TODAY) ? 'Минимум выполнен' : isDoneToday(h) ? 'Выполнено сегодня' : 'Ещё не выполнено';
  const linked = goals.filter(g => (g.habitIds || []).includes(h.id)).map(g => g.name).join(', ');
  const schedule = h.weekTarget ? `${h.weekTarget} дней в неделю` : h.schedule.map(i => DAY_NAMES[i]).join(', ');
  const conditions = document.createElement('section');
  conditions.className = 'detail-conditions';
  conditions.innerHTML = `<p><b>${iconOf(h.icon)} ${status}</b></p><p>${escapeHtml(schedule)}</p>` +
    `<p>${h.stake.mode === 'money' ? `${h.stake.amount} ₽ за невыполнение, ${h.stake.recipient === 'charity' ? 'на благотворительность' : 'создателям'}` : 'Блокировка недоступна'}</p>` +
    (h.min ? `<p>Минимум: ${escapeHtml(h.min)}</p>` : '') +
    (linked ? `<p>Марафон: ${escapeHtml(linked)}</p>` : '') +
    (h.buddy ? `<p>Вместе с @${escapeHtml(h.buddy)}</p>` : '');
  root.prepend(conditions);
  document.getElementById('detail-undo').hidden = !isDoneToday(h);
  document.getElementById('detail-pin').textContent = h.pinned ? 'Открепить' : 'Закрепить';
  const minimum = document.getElementById('hstat-minimum');
  minimum.hidden = !h.min || (isDoneToday(h) && !isMinOn(h, TODAY));
}

async function sharePromiseCard(h) {
  if (!h) return;
  // Render from real data; never include money, private motivation or friend details.
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350;
  const c = canvas.getContext('2d');
  c.fillStyle = '#0B1324'; c.fillRect(0, 0, 1080, 1350);
  c.fillStyle = '#14233B'; c.beginPath(); c.roundRect(64, 64, 952, 1222, 48); c.fill();
  c.fillStyle = '#F4F7FF'; c.font = 'bold 48px Onest, sans-serif'; c.fillText('disbit', 120, 160);
  c.fillStyle = '#4E78FF'; c.fillText('.', 257, 160);
  // Reuse the actual traveler's scene illustration from the app.
  const scene = sceneOf({ scene: 'desert' });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="390" viewBox="0 0 320 132"><style>.w-man path,.w-man circle{fill:none;stroke:#F3EDE4;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.w-man .w-pack{fill:#F3EDE4;fill-opacity:.22;stroke:none}.w-pole{stroke:#F3EDE4;stroke-width:1.6;fill:none}.w-cloth,.w-flag{fill:#EE6A5F;stroke:none}</style><rect width="320" height="132" fill="${scene.sky[1]}"/>${walkerTerrain(scene)}${walkerFinish(scene)}<g transform="translate(145 98)">${walkerFigure(scene)}</g></svg>`;
  try {
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode(); c.drawImage(img, 120, 230, 840, 390);
  } catch { /* The card's text remains usable when an SVG cannot render. */ }
  c.fillStyle = '#36C58A'; c.font = '600 30px Onest, sans-serif';
  c.fillText(isDoneToday(h) ? 'ОБЕЩАНИЕ ВЫПОЛНЕНО' : 'МОЁ ОБЕЩАНИЕ', 120, 720);
  c.fillStyle = '#F4F7FF'; c.font = 'bold 54px Onest, sans-serif';
  let line = '', y = 815;
  for (const char of h.name) {
    if (c.measureText(line + char).width > 820) { c.fillText(line, 120, y); y += 68; line = ''; }
    line += char;
  }
  c.fillText(line, 120, y);
  c.fillStyle = '#AEBBD1'; c.font = '30px Onest, sans-serif';
  c.fillText(formatDay(TODAY), 120, 1120); c.fillText('disbit.ru', 120, 1190);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const file = blob && new File([blob], 'disbit-moment.png', { type: 'image/png' });
  const data = { title: 'Disbit', text: `${isDoneToday(h) ? 'Выполнено: ' : 'Моё обещание: '}${h.name}`, url: 'https://disbit.ru' };
  try {
    if (file && navigator.share && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], ...data });
    else if (navigator.share) await navigator.share(data);
    else if (file) {
      const url = URL.createObjectURL(file), a = document.createElement('a'); a.href = url; a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Карточка сохранена. Ею можно поделиться.');
    }
  } catch (error) { if (error.name !== 'AbortError') toast('Не удалось поделиться. Попробуй ещё раз.'); }
}

function syncPathNavigation(name) {
  const walker = document.getElementById('walker');
  if (name === 'marathon') document.getElementById('marathon-walker-slot').append(walker);
  else document.getElementById('all-marathons').before(walker);
  renderWalker();
  const scene = walker.querySelector('.w-scene');
  if (scene) {
    scene.setAttribute('viewBox', name === 'marathon' ? '0 -48 320 180' : '0 0 320 132');
    const sky = scene.querySelector(':scope > rect');
    sky?.setAttribute('y', '-48'); sky?.setAttribute('height', '180');
    scene.querySelector('.journey-figure')?.setAttribute('transform', name === 'marathon' ? 'scale(1.7)' : 'scale(1)');
  }
  document.getElementById('all-marathons').hidden = !goals.some(isMarathon);
  renderJourneyLinks();
}

function wirePathUI() {
  const $ = id => document.getElementById(id);
  document.querySelector('.skip-link').onclick = e => {
    e.preventDefault(); document.querySelector('.screen.active').focus();
  };
  document.querySelectorAll('#add-overlay input').forEach(el => { el.name = el.id; el.autocomplete = 'off'; });
  document.querySelectorAll('.ic').forEach(el => el.setAttribute('aria-hidden', 'true'));
  document.querySelectorAll('.screen').forEach(screen => {
    screen.tabIndex = -1;
    if (['calendar', 'stats', 'medals', 'avatar'].includes(screen.id.slice(7))) {
      const button = document.createElement('button'); button.className = 'path-back';
      button.innerHTML = `${icon('i-chev-l')}<span>Назад</span>`;
      button.onclick = () => switchScreen(screen.id === 'screen-avatar' ? 'marathon' : 'profile');
      screen.prepend(button);
    }
  });
  $('open-avatar').onclick = () => switchScreen('avatar');
  $('all-marathons').onclick = () => switchScreen('marathon');
  $('today-calendar').onclick = () => switchScreen('calendar');
  $('create-promise').onclick = () => { closeSheet('create-overlay'); openAddSheet(); };
  $('create-marathon').onclick = () => { closeSheet('create-overlay'); openGoalSheet(); };
  $('create-idea').onclick = () => { closeSheet('create-overlay'); $('btn-backlog-add').click(); };
  document.querySelectorAll('[data-close-sheet]').forEach(b => b.onclick = () => closeSheet(b.dataset.closeSheet));
  $('add-overlay').addEventListener('input', e => {
    e.target.removeAttribute('aria-invalid'); $('habit-form-error').hidden = true; updateHabitForm(); rememberHabitDraft();
  });
  window.addEventListener('pagehide', () => { if (!$('add-overlay').hidden) rememberHabitDraft(); });
  $('add-overlay').addEventListener('click', () => queueMicrotask(updateHabitForm));
  $('schedule-mode').querySelectorAll('button').forEach(b => b.onclick = () => setWeekTarget(b.dataset.schedule === 'flex' ? wtValue || 1 : 0));
  $('detail-pin').onclick = () => { togglePin(hstatId); renderHabitStats(); };
  $('detail-share').onclick = () => sharePromiseCard(habits.find(h => h.id === hstatId));
  $('detail-undo').onclick = async () => { await toggleHabit(hstatId); renderHabitStats(); };
  $('proof-share-card').onclick = () => sharePromiseCard(proofHabit);
  $('proof-close').onclick = closeProofBanner;
  $('proof-start').onclick = () => { proofShowCapture(); startProofCam(); };
  // Trap keyboard focus in the visible sheet, including sheets layered over details.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || document.querySelector('dialog[open]')) return;
    const overlay = !$('proof-overlay').hidden ? $('proof-overlay') : [...pathSheetFocus.keys()].reverse().map($).find(el => el && !el.hidden);
    if (!overlay) return;
    const list = [...overlay.querySelectorAll('button, input, select, textarea, summary, a[href], [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
    const first = list[0], last = list.at(-1); if (!first) return;
    if (e.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  });
  const updateInert = () => {
    const open = [...document.querySelectorAll('.sheet-overlay, .proof-overlay')].some(el => !el.hidden);
    document.querySelector('.app').inert = open;
    const top = !$('proof-overlay').hidden ? $('proof-overlay') : anyOpenSheet();
    document.querySelectorAll('.sheet-overlay, .proof-overlay').forEach(el => { el.inert = el.hidden || (!!top && el !== top); });
  };
  document.querySelectorAll('.sheet-overlay, .proof-overlay').forEach(el => new MutationObserver(updateInert).observe(el, { attributes: true, attributeFilter: ['hidden'] }));
  if (window.visualViewport) {
    const updateKeyboard = () => document.body.classList.toggle('kb-open', innerHeight - visualViewport.height > 150 && /INPUT|TEXTAREA/.test(document.activeElement?.tagName));
    visualViewport.addEventListener('resize', updateKeyboard);
    document.addEventListener('focusout', updateKeyboard);
  }
}
