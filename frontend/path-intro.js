import { animate, stagger } from './vendor/anime.esm.min.js';
const box = document.getElementById('intro');
const steps = [...box.querySelectorAll('.intro-step')];
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const finger = document.getElementById('intro-fp');
const skip = document.getElementById('intro-skip');
const last = steps.length - 1;
let page = 0, confirmed = false, finished = false, entrance = [], celebrationTimer;
let finishCallback, initialAnswers, pointerStart = null;
const holdDuration = 1400;
const fill = finger.querySelector('.intro-fingerprint-fill');
let holdTimer, holdAnimation, holdInput = null;
function cancelHold() {
  clearTimeout(holdTimer); holdInput = null;
  holdAnimation?.revert(); holdAnimation = null;
  finger.classList.remove('is-holding');
  if (!confirmed) finger.querySelector('.intro-pledge-label').textContent = 'Даю слово';
}
function beginHold(input) {
  if (holdInput !== null || confirmed || finished || box.hidden || page !== last) return;
  holdInput = input;
  finger.classList.add('is-holding');
  finger.querySelector('.intro-pledge-label').textContent = 'Держи…';
  // Progress is essential feedback; reduced-motion mode omits the success pulse.
  holdAnimation = animate(fill, { scaleY: [0, 1], duration: holdDuration, ease: 'linear' });
  holdTimer = setTimeout(() => {
    if (holdInput !== null && !document.hidden) confirm();
    else cancelHold();
  }, holdDuration);
}
function stopEntrance() { entrance.forEach(a => a.revert()); entrance = []; }
function finish() {
  if (finished) return;
  finished = true; cancelHold(); clearTimeout(celebrationTimer); stopEntrance();
  box.hidden = true; document.querySelector('.app').inert = false;
  finishCallback?.({ ...initialAnswers, pledged: confirmed });
}
function scheduleRegistration() {
  clearTimeout(celebrationTimer);
  if (!document.hidden && confirmed && !finished) celebrationTimer = setTimeout(finish, 2100);
}
function confirm() {
  if (confirmed || finished || page !== last) return;
  cancelHold();
  confirmed = true; finger.disabled = true; finger.classList.add('is-confirmed');
  finger.querySelector('img').src = 'icons/intro/check.svg';
  finger.querySelector('.intro-pledge-label').textContent = 'Слово дано';
  document.getElementById('intro-commit-title').innerHTML = 'Ты уже<span> начал.</span>';
  document.getElementById('intro-fp-hint').textContent = 'Поздравляем! Теперь сохраним твой путь.';
  box.classList.add('intro-celebrating');
  if (!reduced.matches) entrance.push(animate(finger, { scale: [1, 1.05, 1], duration: 600, ease: 'outCubic' }));
  scheduleRegistration();
}
function show(index) {
  if (confirmed || finished) return;
  cancelHold();
  const previous = page;
  page = Math.max(0, Math.min(last, index)); stopEntrance();
  box.dataset.step = steps[page].dataset.step;
  steps.forEach((step, i) => { step.hidden = i !== page; step.inert = i !== page; });
  [...document.getElementById('intro-pagination').children].forEach((dot, i) => dot.classList.toggle('on', i === page));
  document.getElementById('intro-position').textContent = (page + 1) + ' из ' + steps.length;
  box.querySelector('.intro-swipe-hint').textContent = page === last ? 'Твоё обещание — только тебе' : matchMedia('(pointer: fine)').matches ? 'Колесо мыши · ← → · клик справа' : 'Листай или нажми справа →';
  box.scrollTop = 0;
  const title = steps[page].querySelector('h2'); title.tabIndex = -1; title.focus({ preventScroll: true });
  if (!reduced.matches) {
    entrance.push(animate(steps[page], { opacity: [0, 1], translateX: [previous > page ? -20 : 20, 0], duration: 320, ease: 'outCubic' }));
    const targets = steps[page].querySelectorAll('.intro-object, .intro-feature-list li');
    if (targets.length) entrance.push(animate(targets, { opacity: [0, 1], translateY: [18, 0], delay: stagger(45), duration: 500, ease: 'outCubic' }));
    if (page === 1) entrance.push(animate('#intro-traveler', { translateX: [-35, 0], duration: 1200, ease: 'outCubic' }));
  }
}
document.getElementById('intro-pagination').innerHTML = steps.map(() => '<i></i>').join('');
skip.addEventListener('click', finish);
// A click alone never confirms. Pointer and keyboard holds share the same timer.
finger.addEventListener('click', e => e.preventDefault());
finger.addEventListener('contextmenu', e => e.preventDefault());
finger.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !e.isPrimary) return;
  e.preventDefault(); finger.focus({ preventScroll: true });
  beginHold(e.pointerId); finger.setPointerCapture(e.pointerId);
});
finger.addEventListener('pointermove', e => {
  if (holdInput !== e.pointerId) return;
  const r = finger.getBoundingClientRect();
  if (Math.hypot((e.clientX - r.left - r.width / 2) / (r.width / 2), (e.clientY - r.top - r.height / 2) / (r.height / 2)) > 1) cancelHold();
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  finger.addEventListener(event, e => { if (holdInput === e.pointerId) cancelHold(); });
}
finger.addEventListener('keydown', e => {
  if (e.key !== ' ' && e.key !== 'Enter') return;
  e.preventDefault(); if (!e.repeat) beginHold(e.key);
});
finger.addEventListener('keyup', e => {
  if (e.key !== ' ' && e.key !== 'Enter') return;
  e.preventDefault(); if (holdInput === e.key) cancelHold();
});
finger.addEventListener('blur', cancelHold);
window.addEventListener('blur', cancelHold);
box.addEventListener('dragstart', e => e.preventDefault());
document.addEventListener('keydown', e => {
  if (box.hidden) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(page + (e.key === 'ArrowRight' ? 1 : -1)); }
  if (e.key === 'Escape' && !confirmed) { e.preventDefault(); finish(); }
  if (e.key === 'Tab') {
    e.preventDefault();
    const controls = page === last && !confirmed ? [skip, finger] : [skip];
    const current = controls.indexOf(document.activeElement);
    const next = current < 0 ? (e.shiftKey ? controls.length - 1 : 0) : (current + (e.shiftKey ? -1 : 1) + controls.length) % controls.length;
    controls[next].focus();
  }
});
box.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('button') || confirmed) return;
  pointerStart = { id: e.pointerId, x: e.clientX, y: e.clientY }; box.setPointerCapture(e.pointerId);
});
box.addEventListener('pointerup', e => {
  if (!pointerStart || pointerStart.id !== e.pointerId) return;
  const dx = e.clientX - pointerStart.x, dy = e.clientY - pointerStart.y; pointerStart = null;
  if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) show(page + (dx < 0 ? 1 : -1));
  else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
    const bounds = box.querySelector('.intro-shell').getBoundingClientRect();
    if (e.clientX >= bounds.left && e.clientX <= bounds.right) show(page + (e.clientX < bounds.left + bounds.width * .35 ? -1 : 1));
  }
});
box.addEventListener('pointercancel', () => { pointerStart = null; });
box.addEventListener('lostpointercapture', () => { pointerStart = null; });
// One wheel/trackpad gesture changes one slide; native scrolling still works
// within tall slides. A new gesture at the boundary proceeds to the next slide.
let wheelAt = 0, wheelAmount = 0, wheelLocked = false;
box.addEventListener('wheel', e => {
  if (confirmed || e.ctrlKey || !e.deltaX && !e.deltaY) return;
  const now = performance.now();
  if (now - wheelAt > 180) { wheelAmount = 0; wheelLocked = false; }
  wheelAt = now;
  const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
  const delta = (horizontal ? e.deltaX : e.deltaY) * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? box.clientHeight : 1);
  const canScroll = !horizontal && (delta > 0 ? box.scrollTop + box.clientHeight < box.scrollHeight - 2 : box.scrollTop > 2);
  if (canScroll) { wheelLocked = true; return; }
  e.preventDefault();
  if (wheelLocked) return;
  wheelAmount += delta;
  if (Math.abs(wheelAmount) >= 45) { wheelLocked = true; show(page + (wheelAmount > 0 ? 1 : -1)); }
}, { passive: false });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelHold(); clearTimeout(celebrationTimer); stopEntrance(); pointerStart = null; } else scheduleRegistration();
});
reduced.addEventListener('change', stopEntrance);
window.DisbitIntro = {
  open({ initial = {}, onFinish } = {}) {
    cancelHold(); clearTimeout(celebrationTimer); stopEntrance(); pointerStart = null;
    wheelAt = 0; wheelAmount = 0; wheelLocked = false;
    initialAnswers = initial; finishCallback = onFinish; finished = false; confirmed = false;
    finger.disabled = false; finger.classList.remove('is-confirmed'); box.classList.remove('intro-celebrating');
    finger.querySelector('img').src = 'icons/intro/fingerprint.svg';
    finger.querySelector('.intro-pledge-label').textContent = 'Даю слово';
    document.getElementById('intro-commit-title').innerHTML = 'Обещаю себе<br><span>начать.</span>';
    document.getElementById('intro-fp-hint').textContent = 'Удерживай, чтобы дать слово.';
    if (!document.getElementById('intro-traveler').childElementCount && typeof pathTravelerArtwork === 'function') document.getElementById('intro-traveler').innerHTML = pathTravelerArtwork('cap');
    box.hidden = false; document.querySelector('.app').inert = true; show(0);
  }
};
