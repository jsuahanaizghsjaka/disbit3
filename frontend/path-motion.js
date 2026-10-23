/* Disbit adaptations of Account Menu, Stack Panel, Wheel Picker, Hold Button,
 * Switch Button and Pull Cord by @dorianbaffier (KokonutUI, MIT).
 * Vanilla DOM/WAAPI; existing business handlers remain the source of truth.
 * Attribution: vendor/KOKONUTUI-NOTICE.md. */
'use strict';

function motionReduced() {
  return settings.motion === 'reduce' || document.documentElement.dataset.motion === 'reduce' ||
    matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function motionEnter(node, direction = 1, pointer = true) {
  node.getAnimations().forEach(a => a.cancel());
  if (!pointer || motionReduced()) return;
  node.animate([{opacity: 0, transform: `translateX(${direction * 16}px)`},
    {opacity: 1, transform: 'translateX(0)'}], {duration: 220, easing: 'cubic-bezier(.23,1,.32,1)'});
}

function buildProfileMotion() {
  const root = document.getElementById('screen-profile');
  // Deposit never lives inside a disclosure. Move the actual node, not a copy.
  const walletCard = document.getElementById('wallet-card');
  const money = document.getElementById('profile-money');
  const moneySection = document.createElement('div'); moneySection.id = 'profile-money';
  moneySection.append(walletCard); money.replaceWith(moneySection);
  root.querySelector('.profile-hero').after(moneySection);

  const progress = document.getElementById('profile-progress');
  const sections = [
    ['achievements', 'Достижения', 'i-award', ['ach-card']],
    ['progress', 'Мой прогресс', 'i-chart', ['btn-open-stats', 'btn-open-calendar']],
    ['motivation', 'Мотивация', 'i-flame', ['mot-text']],
    ['rewards', 'Награды себе', 'i-gift', ['reward-list']]
  ];
  sections.forEach(([id, label, symbol, ids]) => {
    const group = document.createElement('details'); group.className = 'profile-group motion-account-row';
    group.id = `profile-motion-${id}`;
    const summary = document.createElement('summary');
    summary.innerHTML = `${icon(symbol)}<span>${label}</span>`;
    group.append(summary); progress.before(group);
    ids.forEach(id => { const card = document.getElementById(id)?.closest('.card'); if (card) group.append(card); });
  });
  progress.remove();
  const symbols = {account: 'i-user', settings: 'i-palette', data: 'i-download'};
  Object.entries(symbols).forEach(([id, symbol]) => {
    const group = document.getElementById(`profile-${id}`); group.classList.add('motion-account-row');
    const summary = group.querySelector('summary');
    const label = summary.textContent; summary.innerHTML = `${icon(symbol)}<span>${label}</span>`;
  });
  const groups = [...root.querySelectorAll('.profile-group')];
  groups.forEach(group => {
    let pointer = false;
    group.querySelector('summary').addEventListener('click', event => { pointer = event.detail !== 0; });
    group.addEventListener('toggle', () => {
      if (!group.open) return;
      groups.forEach(other => { if (other !== group) other.open = false; });
      [...group.children].slice(1).forEach(child => motionEnter(child, 1, pointer));
    });
  });
  buildSettingsStack();
  buildProfileCord(root);
}

function buildSettingsStack() {
  const card = document.getElementById('set-offday').closest('.card');
  const original = [...card.children];
  const home = document.createElement('div'); home.className = 'settings-stack-home';
  const body = document.createElement('div'); body.className = 'settings-stack-page'; body.hidden = true;
  const back = document.createElement('button'); back.type = 'button'; back.className = 'row-btn stack-back';
  back.textContent = '← Все настройки';
  const title = document.createElement('h3'); title.className = 'card-title';
  const content = document.createElement('div');
  body.append(back, title, content); card.replaceChildren(home, body);
  const pages = [
    {name: 'Обещания и итог дня', nodes: original.slice(1, 4)},
    {name: 'Оформление и движение', nodes: original.slice(4, 6)},
    {name: 'Напоминания', nodes: original.slice(6, 8)},
    {name: 'Блокировка приложений', nodes: original.slice(8)}
  ];
  // All controls stay mounted so asynchronous settings updates can still find them.
  pages.forEach(page => {
    const panel = document.createElement('div'); panel.hidden = true; panel.append(...page.nodes); content.append(panel);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'row-btn stack-link';
    button.textContent = page.name; button.setAttribute('aria-label', page.name); home.append(button);
    button.onclick = event => {
      home.hidden = true; body.hidden = false; pages.forEach(p => { if (p.panel) p.panel.hidden = true; });
      panel.hidden = false; title.textContent = page.name; motionEnter(body, 1, event.detail !== 0); back.focus({preventScroll: true});
      back.onclick = e => { body.hidden = true; home.hidden = false; motionEnter(home, -1, e.detail !== 0); button.focus({preventScroll: true}); };
    };
    page.panel = panel;
  });
  const theme = document.createElement('a'); theme.href = '#avatar'; theme.className = 'row-btn theme-switch-link';
  theme.innerHTML = '<span class="theme-switch-art" aria-hidden="true"><span>◐</span></span><span>Выбрать тему</span>';
  pages[1].panel.prepend(theme);
}

let activeThemeTransition;
async function revealDisbitTheme(trigger, pointer, update) {
  activeThemeTransition?.skipTransition();
  if (!pointer || motionReduced() || !document.startViewTransition) { update(); return; }
  const box = trigger.getBoundingClientRect();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const transition = document.startViewTransition(update); activeThemeTransition = transition;
  try {
    await transition.ready;
    if (transition !== activeThemeTransition) return;
    await document.documentElement.animate({clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`]},
      {duration: 280, easing: 'cubic-bezier(.23,1,.32,1)', pseudoElement: '::view-transition-new(root)'}).finished;
  } catch { /* Interrupted by another selection or tab visibility; update still ran. */ }
  finally { if (activeThemeTransition === transition) activeThemeTransition = null; }
}

// A hold never commits from an animation's finish event: reduced-motion changes
// can finish animations globally. Only the deliberate interaction timer commits.
const holdControllers = new WeakMap();
function enhanceHoldButton(button, enabled = true) {
  let controller = holdControllers.get(button);
  if (controller) { controller.enable(enabled); return; }
  if (!enabled) return;
  let active = true, timer = 0, progress, fill, bypass = false, pointerId = null;
  const originalDescription = button.getAttribute('aria-describedby');
  const help = document.createElement('div'); help.className = 'hold-help sr-only';
  const hint = document.createElement('p'); hint.className = 'hint'; hint.id = `hold-hint-${button.id || 'confirm'}`;
  hint.textContent = 'Удерживай 1 секунду. С клавиатуры нажми Enter.';
  help.append(hint); button.after(help);
  function cancel() {
    clearTimeout(timer); timer = 0; progress?.cancel(); progress = null; fill?.remove();
    button.classList.remove('is-holding');
    if (pointerId !== null && button.hasPointerCapture(pointerId)) button.releasePointerCapture(pointerId);
    pointerId = null;
  }
  function commit() {
    cancel(); if (!active || button.disabled || !button.isConnected || button.getClientRects().length === 0) return;
    bypass = true; button.click(); bypass = false;
  }
  function start() {
    if (!active || button.disabled || timer) return;
    button.classList.add('is-holding');
    fill = document.createElement('span'); fill.className = 'hold-fill'; fill.setAttribute('aria-hidden', 'true'); button.append(fill);
    progress = fill.animate([{transform: 'scaleX(0)'}, {transform: 'scaleX(1)'}], {duration: 1000, easing: 'linear', fill: 'forwards'});
    timer = setTimeout(commit, 1000);
  }
  button.addEventListener('click', event => {
    if (active && !bypass && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); hint.setAttribute('role', 'status'); }
  }, true);
  button.addEventListener('pointerdown', event => {
    if (!active || event.button !== 0 || button.disabled) return;
    pointerId = event.pointerId; button.setPointerCapture(pointerId); start();
  });
  button.addEventListener('pointermove', event => {
    if (pointerId !== event.pointerId) return;
    const r = button.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) cancel();
  });
  ['pointerup', 'pointercancel', 'lostpointercapture', 'blur'].forEach(type => button.addEventListener(type, cancel));
  button.addEventListener('keydown', event => {
    if (!active || event.key !== ' ') return;
    event.preventDefault(); if (!event.repeat) start();
  });
  button.addEventListener('keyup', event => { if ([' ', 'Enter'].includes(event.key)) cancel(); });
  window.addEventListener('blur', cancel); window.addEventListener('pagehide', cancel);
  document.addEventListener('visibilitychange', cancel);
  button.closest('dialog')?.addEventListener('close', cancel);
  controller = {enable(value) {
    cancel(); active = value; help.hidden = !value; button.classList.toggle('hold-button', value);
    if (value) button.setAttribute('aria-describedby', [originalDescription, hint.id].filter(Boolean).join(' '));
    else if (originalDescription) button.setAttribute('aria-describedby', originalDescription);
    else button.removeAttribute('aria-describedby');
  }};
  holdControllers.set(button, controller); controller.enable(enabled);
}

// Perspective wheel from the supplied Wheel Picker: one draft, bounded values,
// pointer drag, wheel and arrow keys. Marathon inputs are backing values only.
let wheelDialog;
function openDisbitWheel(input, title) {
  if (wheelDialog?.open) return;
  if (!wheelDialog) {
    wheelDialog = document.createElement('dialog'); wheelDialog.className = 'motion-wheel-dialog';
    wheelDialog.innerHTML = '<h2 id="wheel-title"></h2><p class="hint">Прокрути или используй стрелки. Изменения сохранятся по кнопке «Выбрать».</p><div class="motion-wheels"></div><div class="dialog-actions"><button type="button" class="btn-ghost" data-wheel-cancel>Отмена</button><button type="button" class="btn-primary" data-wheel-apply>Выбрать</button></div>';
    wheelDialog.setAttribute('aria-labelledby', 'wheel-title'); document.body.append(wheelDialog);
  }
  const date = input.type === 'date', time = input.type === 'time';
  const today = new Date();
  const initial = input.value ? input.value.split(date ? '-' : ':').map(Number) :
    date ? [today.getFullYear(), today.getMonth() + 1, today.getDate()] : time ? [9, 0] : [Number(input.min) || 0];
  const draft = initial.slice(); const wheels = [];
  const descriptors = date ? [
    ['День', 2, 1, () => new Date(draft[0], draft[1], 0).getDate()],
    ['Месяц', 1, 1, () => 12],
    ['Год', 0, Math.min(today.getFullYear(), initial[0]), () => Math.max(today.getFullYear() + 10, initial[0])]
  ] : time ? [['Часы', 0, 0, () => 23], ['Минуты', 1, 0, () => 59]] :
    [[input.id === 'g-steps' ? 'Шаги' : 'Дни', 0, Number(input.min) || 0, () => Number(input.max) || 999]];
  const box = wheelDialog.querySelector('.motion-wheels'); box.replaceChildren();
  wheelDialog.querySelector('h2').textContent = title;
  const cleanups = [];
  descriptors.forEach(([label, index, min, max]) => {
    draft[index] = Math.max(min, Math.min(max(), draft[index] || 0));
    const col = document.createElement('div'); col.className = 'motion-wheel-column';
    const name = document.createElement('span'); name.className = 'hint'; name.textContent = label;
    const up = document.createElement('button'); up.type = 'button'; up.textContent = '−'; up.setAttribute('aria-label', `${label}: меньше`);
    const down = document.createElement('button'); down.type = 'button'; down.textContent = '+'; down.setAttribute('aria-label', `${label}: больше`);
    const drum = document.createElement('div'); drum.className = 'motion-wheel'; drum.tabIndex = 0;
    drum.setAttribute('role', 'spinbutton'); drum.setAttribute('aria-label', label);
    const strip = document.createElement('div'); strip.className = 'motion-wheel-strip'; drum.append(strip);
    col.append(name, up, drum, down); box.append(col);
    let drag = null, offset = 0;
    function draw() {
      draft[index] = Math.max(min, Math.min(max(), draft[index]));
      drum.setAttribute('aria-valuemin', min); drum.setAttribute('aria-valuemax', max()); drum.setAttribute('aria-valuenow', draft[index]);
      up.disabled = draft[index] <= min; down.disabled = draft[index] >= max();
      strip.replaceChildren();
      for (let delta = -2; delta <= 2; delta++) {
        const value = draft[index] + delta;
        const row = document.createElement('span'); row.textContent = value < min || value > max() ? '' : String(value).padStart(time ? 2 : 1, '0');
        row.setAttribute('aria-hidden', 'true'); row.className = delta === 0 ? 'is-selected' : '';
        row.style.transform = motionReduced() ? 'none' : `rotateX(${-delta * 18}deg) scale(${1 - Math.abs(delta) * .08})`;
        strip.append(row);
      }
      strip.style.transform = `translateY(${offset}px)`;
    }
    function change(value, pointer = true) {
      const before = draft[index]; draft[index] = Math.round(Math.max(min, Math.min(max(), value))); offset = 0;
      wheels.forEach(w => w.draw());
      if (pointer && !motionReduced() && before !== draft[index]) {
        strip.getAnimations().forEach(a => a.cancel());
        strip.animate([{transform: `translateY(${Math.sign(draft[index] - before) * 40}px)`}, {transform: 'translateY(0)'}], {duration: 180, easing: 'cubic-bezier(.23,1,.32,1)'});
      }
    }
    up.onclick = e => change(draft[index] - 1, e.detail !== 0); down.onclick = e => change(draft[index] + 1, e.detail !== 0);
    drum.onkeydown = e => {
      const next = {ArrowUp: draft[index] - 1, ArrowDown: draft[index] + 1, PageUp: draft[index] - 10, PageDown: draft[index] + 10, Home: min, End: max()}[e.key];
      if (next !== undefined) { e.preventDefault(); change(next, false); }
    };
    let wheelDelta = 0;
    drum.addEventListener('wheel', e => {
      e.preventDefault(); wheelDelta += e.deltaY;
      if (Math.abs(wheelDelta) >= 24) { change(draft[index] + Math.sign(wheelDelta)); wheelDelta = 0; }
    }, {passive: false});
    drum.onpointerdown = e => {
      if (e.button !== 0) return;
      strip.getAnimations().forEach(a => a.cancel());
      drag = {id: e.pointerId, y: e.clientY, initial: draft[index]}; drum.setPointerCapture(e.pointerId);
    };
    drum.onpointermove = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const displacement = (drag.y - e.clientY) / 40;
      const value = Math.max(min, Math.min(max(), Math.round(drag.initial + displacement)));
      draft[index] = value; offset = Math.max(-18, Math.min(18, (value - drag.initial - displacement) * 40));
      wheels.forEach(w => w.draw());
    };
    const release = () => { if (!drag) return; drag = null; offset = 0; draw(); };
    drum.onpointerup = release; drum.onpointercancel = release; drum.onlostpointercapture = release;
    cleanups.push(release); wheels.push({draw}); draw();
  });
  wheelDialog.querySelector('[data-wheel-cancel]').onclick = () => wheelDialog.close('cancel');
  wheelDialog.querySelector('[data-wheel-clear]')?.remove();
  if (date) {
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'btn-ghost';
    clear.dataset.wheelClear = ''; clear.textContent = 'Без срока';
    clear.onclick = () => { input.value = ''; input.dispatchEvent(new Event('change', {bubbles:true})); wheelDialog.close('clear'); };
    wheelDialog.querySelector('.dialog-actions').prepend(clear);
  }
  wheelDialog.querySelector('[data-wheel-apply]').onclick = () => {
    wheels.forEach(w => w.draw());
    input.value = date ? `${draft[0]}-${String(draft[1]).padStart(2, '0')}-${String(draft[2]).padStart(2, '0')}` :
      time ? draft.map(n => String(n).padStart(2, '0')).join(':') : String(draft[0]);
    input.dispatchEvent(new Event('input', {bubbles: true})); input.dispatchEvent(new Event('change', {bubbles: true}));
    wheelDialog.close('apply');
  };
  wheelDialog.addEventListener('close', () => { cleanups.forEach(fn => fn()); }, {once: true});
  wheelDialog.showModal();
}

function buildProfileCord(root) {
  const card = document.createElement('section'); card.className = 'profile-cord';
  card.innerHTML = '<h3>Немного света для себя</h3><svg viewBox="0 0 288 240" aria-hidden="true"><path class="cord-wall" d="M96 164V34h90v42"/><path class="cord-shade" d="M147 76h78l-18-38h-42Z"/><ellipse class="cord-light" cx="185" cy="188" rx="70" ry="25"/><path class="cord-line"/><circle class="cord-handle" r="8" cx="207" cy="178"/></svg><button class="btn-ghost" type="button" role="switch" aria-checked="false">Включить свет</button><p class="hint">Потяни за шнурок или нажми кнопку</p>';
  root.querySelector('.about-note').before(card);
  const svg = card.querySelector('svg'), line = card.querySelector('.cord-line'), handle = card.querySelector('.cord-handle');
  const button = card.querySelector('button');
  // Verlet integration and distance constraints adapted from the supplied Pull Cord.
  const links = 12, length = 8.5, xs = Array(links).fill(207), ys = Array.from({length: links}, (_, i) => 76 + i * length);
  let px = xs.slice(), py = ys.slice(), held = null, frame = 0, rest = 0, last = 0, accumulator = 0, armed = true, settleUntil = 0;
  const toggle = () => { const on = button.getAttribute('aria-checked') !== 'true'; button.setAttribute('aria-checked', on); button.textContent = on ? 'Выключить свет' : 'Включить свет'; card.classList.toggle('is-lit', on); };
  function draw() {
    let d = `M${xs[0]} ${ys[0]}`;
    for (let i = 1; i < links - 1; i++) d += `Q${xs[i]} ${ys[i]} ${(xs[i] + xs[i + 1]) / 2} ${(ys[i] + ys[i + 1]) / 2}`;
    line.setAttribute('d', d + `L${xs[links - 1]} ${ys[links - 1]}`);
    handle.setAttribute('cx', xs[links - 1]); handle.setAttribute('cy', ys[links - 1]);
  }
  function step() {
    let speed = 0;
    for (let i = 1; i < links; i++) {
      const vx = Math.max(-4, Math.min(4, (xs[i] - px[i]) * .992));
      const vy = Math.max(-4, Math.min(4, (ys[i] - py[i]) * .992));
      px[i] = xs[i]; py[i] = ys[i]; xs[i] += vx; ys[i] += vy + 1400 / 14400; speed += Math.abs(vx) + Math.abs(vy);
    }
    for (let n = 0; n < 14; n++) {
      xs[0] = 207; ys[0] = 76;
      if (held) { xs[links - 1] = held.x; ys[links - 1] = held.y; }
      for (let i = 1; i < links; i++) {
        const dx = xs[i] - xs[i - 1], dy = ys[i] - ys[i - 1], dist = Math.hypot(dx, dy) || 1;
        const correction = (dist - length) / dist;
        if (!(held && i === links - 1)) { xs[i] -= dx * correction * .5; ys[i] -= dy * correction * .5; }
        if (i > 1) { xs[i - 1] += dx * correction * .5; ys[i - 1] += dy * correction * .5; }
      }
    }
    rest = speed < .2 ? rest + 1 : 0;
  }
  function tick(now) {
    frame = 0;
    if (document.hidden || !card.getClientRects().length || motionReduced() || (!held && now > settleUntil)) { reset(); return; }
    accumulator += Math.min(32, now - (last || now)); last = now;
    while (accumulator >= 1000 / 120) { step(); accumulator -= 1000 / 120; }
    draw(); if (held || rest < 24) frame = requestAnimationFrame(tick);
  }
  function wake() { rest = 0; if (!frame) { last = 0; frame = requestAnimationFrame(tick); } }
  function reset() {
    cancelAnimationFrame(frame); frame = 0; held = null;
    for (let i = 0; i < links; i++) { xs[i] = 207; ys[i] = 76 + i * length; }
    px = xs.slice(); py = ys.slice(); draw();
  }
  handle.onpointerdown = e => { if (e.button !== 0) return; e.preventDefault(); handle.setPointerCapture(e.pointerId); held = {id: e.pointerId, x: xs[links - 1], y: ys[links - 1]}; armed = true; if (!motionReduced()) wake(); };
  handle.onpointermove = e => {
    if (!held || held.id !== e.pointerId) return;
    const rect = svg.getBoundingClientRect(); const scale = 288 / rect.width;
    const x = (e.clientX - rect.left) * scale, y = (e.clientY - rect.top) * scale;
    const dx = x - 207, dy = y - 76, distance = Math.hypot(dx, dy) || 1, reach = length * (links - 1);
    const stretch = Math.max(0, distance - reach), damped = reach + 34 * (1 - Math.exp(-stretch / 34));
    held.x = 207 + dx * Math.min(distance, damped) / distance; held.y = 76 + dy * Math.min(distance, damped) / distance;
    if (stretch > 22 && armed) { toggle(); armed = false; }
    if (stretch < 8.8) armed = true;
    if (motionReduced()) { xs[links - 1] = held.x; ys[links - 1] = held.y; draw(); }
  };
  const release = () => { held = null; settleUntil = performance.now() + 1200; if (motionReduced()) reset(); else wake(); };
  handle.onpointerup = release; handle.onpointercancel = release; handle.onlostpointercapture = release;
  button.onclick = toggle; document.addEventListener('visibilitychange', reset); window.addEventListener('pagehide', reset);
  new IntersectionObserver(entries => { if (!entries[0].isIntersecting) reset(); }).observe(card);
  draw();
}

function wireMotionUI() {
  buildProfileMotion();
  wireArchiveUI();
  [['g-deadline', 'Срок марафона'], ['g-steps', 'Длина марафона'], ['rw-days', 'Серия для награды'],
    ['set-notif-morning', 'Утреннее напоминание'], ['set-notif-evening', 'Вечернее напоминание']].forEach(([id, title]) => {
    const input = document.getElementById(id); if (!input) return;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'wheel-open row-btn';
    button.textContent = 'Выбрать прокруткой'; button.setAttribute('aria-label', `${title}: выбрать прокруткой`);
    button.onclick = () => openDisbitWheel(input, title); input.after(button);
    if (id.startsWith('g-')) {
      button.id = id + '-wheel'; button.setAttribute('aria-haspopup', 'dialog');
      document.querySelector(`label[for="${id}"]`)?.setAttribute('for', button.id);
    }
  });
  ['btn-save', 'proof-send'].forEach(id => { const button = document.getElementById(id); if (button) enhanceHoldButton(button); });
  syncJourneyWheels();
}

function syncJourneyWheels() {
  for (const id of ['g-deadline', 'g-steps']) {
    const input = document.getElementById(id), button = document.getElementById(id + '-wheel');
    if (!button) continue;
    button.textContent = id === 'g-deadline' ? (input.value ? formatDay(input.value) : 'Без срока') : `${input.value || 0} шагов`;
    button.setAttribute('aria-label', `${id === 'g-deadline' ? 'Срок марафона' : 'Шагов до финиша'}: ${button.textContent}. Выбрать прокруткой`);
  }
}
