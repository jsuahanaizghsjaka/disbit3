const html = await (await fetch('./index.html')).text();
const intro = new DOMParser().parseFromString(html, 'text/html').getElementById('intro');
document.body.append(intro);
await import('./path-intro.js');
const open = () => window.DisbitIntro.open({ onFinish: () => location.assign('./#register') });
document.getElementById('preview-again').onclick = open;
open();
