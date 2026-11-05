import { animate, stagger } from './vendor/anime.esm.min.js';

const overlay = document.getElementById('auth-overlay');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let animations = [];
let previousView = '';

function presentWelcome() {
  const view = overlay.hidden || document.hidden ? '' : overlay.dataset.view;
  if (view === previousView) return;
  previousView = view;
  animations.forEach(animation => animation.revert());
  animations = [];
  if (!view || reducedMotion.matches) return;
  animations.push(animate(overlay.querySelector('.auth-content'), {
    opacity: [0, 1], translateY: [14, 0], duration: 360, ease: 'outCubic'
  }));
  if (view === 'register') {
    animations.push(animate(overlay.querySelectorAll('.welcome-object'), {
      opacity: [0, 1], translateY: [32, 0], scale: [.85, 1],
      delay: stagger(90), duration: 950, ease: 'outExpo'
    }));
  }
}

new MutationObserver(presentWelcome).observe(overlay, {
  attributes: true, attributeFilter: ['hidden', 'data-view']
});
document.addEventListener('visibilitychange', presentWelcome);
reducedMotion.addEventListener('change', () => {
  previousView = '';
  animations.forEach(animation => animation.revert());
  animations = [];
  presentWelcome();
});
presentWelcome();
