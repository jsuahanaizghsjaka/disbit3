/* Seeded face geometry adapted from Avatar Picker by @dorianbaffier,
 * KokonutUI, MIT. See vendor/KOKONUTUI-NOTICE.md. No user text enters SVG markup. */
'use strict';
function createDisbitFace(seed) {
  let hash = 2166136261;
  for (const c of String(seed)) { hash ^= c.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  let a = hash >>> 0;
  const r = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = list => list[Math.floor(r() * list.length)];
  const bg = pick([[228,228,231],[233,226,214],[217,225,213],[218,225,233],[235,221,214],[226,223,233]]);
  const shape = {
    headW:18+r()*5, headH:22+r()*4, headSquare:r(), chin:.75+r()*.25,
    hairVolume:r(), hairFringe:r(), hairPart:r()*2-1, hairLength:r()**1.6,
    eyeGap:7.5+r()*3, eyeY:-2+r()*4, eyeRx:1.7+r()*.9, eyeRy:1.9+r()*1.4,
    browTilt:-2+r()*4, browLift:4.2+r()*2, browWeight:r()<.65?1.3+r()*.8:0,
    mouthW:3.5+r()*3, mouthCurve:r()*4.5, mouthOpen:r()<.3?.6+r()*.4:0,
    nose:r(), glasses:r()<.25?1:0, cheeks:r(), shoulders:r()
  };
  return {shape, bg, skin:pick([[246,233,222],[236,210,187],[214,176,142],[176,128,96],[128,88,66]]),
    hair:pick([[39,39,42],[63,45,36],[113,84,62],[161,161,170],[82,82,91]]),
    shirt:pick([[39,39,42],[82,82,91],[113,113,122],[244,244,245]])};
}
function disbitFaceSvg(face) {
  const s = face.shape, n = v => Math.round(v * 100) / 100;
  const rgb = (c,k=1) => `rgb(${c.map(v=>Math.round(v*k)).join(' ')})`;
  function blob(cx,cy,w,top,bottom,square,chin=1) {
    const k=.552+square*.28, kb=k*chin;
    return `M${n(cx)} ${n(cy-top)}C${n(cx+k*w)} ${n(cy-top)} ${n(cx+w)} ${n(cy-k*top)} ${n(cx+w)} ${n(cy)}C${n(cx+w)} ${n(cy+kb*bottom)} ${n(cx+kb*w)} ${n(cy+bottom)} ${n(cx)} ${n(cy+bottom)}C${n(cx-kb*w)} ${n(cy+bottom)} ${n(cx-w)} ${n(cy+kb*bottom)} ${n(cx-w)} ${n(cy)}C${n(cx-w)} ${n(cy-k*top)} ${n(cx-k*w)} ${n(cy-top)} ${n(cx)} ${n(cy-top)}Z`;
  }
  const w=s.headW,h=s.headH,v=s.hairVolume,temple=50-h*.12,crown=50-h-1.5-v*4,side=w+1.5+v*2.5;
  const k=.552+s.headSquare*.28, fringe=50-h*(.66-s.hairFringe*.36),part=50+s.hairPart*w*.55;
  const hair=`M${n(50-side)} ${n(temple)}C${n(50-side)} ${n(50-h*k-v*3)} ${n(50-k*side)} ${n(crown)} 50 ${n(crown)}C${n(50+k*side)} ${n(crown)} ${n(50+side)} ${n(50-h*k-v*3)} ${n(50+side)} ${n(temple)}L${n(50+w-1)} ${n(temple)}Q${n(50+w*.75)} ${n(fringe+1-s.hairPart*5)} ${n(part)} ${n(fringe-2.5)}Q${n(50-w*.75)} ${n(fringe+1+s.hairPart*5)} ${n(50-w+1)} ${n(temple)}Z`;
  const eye=50+s.eyeY,mouth=50+h*.5,shoulder=50+h+3,sw=30+s.shoulders*8,glass=Math.max(s.eyeRx,s.eyeRy)+3.2;
  return `<svg class="face-avatar" viewBox="12 14 76 76" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <rect width="100" height="100" fill="${rgb(face.bg)}"/>
    <path d="${blob(50,50-h*.15,w+1+v*2.5,h*.85+v*4,h*.15+s.hairLength*(h+14),s.headSquare*.6)}" fill="${rgb(face.hair,.9)}"/>
    <path d="M${n(50-sw)} 100C${n(50-sw)} ${n(shoulder+6)} ${n(50-sw*.55)} ${n(shoulder)} 50 ${n(shoulder)}C${n(50+sw*.55)} ${n(shoulder)} ${n(50+sw)} ${n(shoulder+6)} ${n(50+sw)} 100Z" fill="${rgb(face.shirt)}"/>
    <rect x="44" y="${n(50+h-6)}" width="12" height="12" rx="3" fill="${rgb(face.skin,.9)}"/>
    <g fill="${rgb(face.skin,.95)}"><ellipse cx="${n(50-w)}" cy="52" rx="3" ry="4.5"/><ellipse cx="${n(50+w)}" cy="52" rx="3" ry="4.5"/></g>
    <path d="${blob(50,50,w,h,h,s.headSquare,s.chin)}" fill="${rgb(face.skin)}"/>
    <path d="${hair}" fill="${rgb(face.hair)}"/>
    <g fill="#18181b" opacity="${n(.045*s.cheeks)}"><circle cx="${n(47-s.eyeGap)}" cy="${n(eye+7)}" r="3.4"/><circle cx="${n(53+s.eyeGap)}" cy="${n(eye+7)}" r="3.4"/></g>
    <g stroke="#18181b" stroke-linecap="round" stroke-width="${n(s.browWeight)}"><path d="M${n(50-s.eyeGap-3.2)} ${n(eye-s.browLift+s.browTilt)}L${n(50-s.eyeGap+3.2)} ${n(eye-s.browLift-s.browTilt)}"/><path d="M${n(50+s.eyeGap-3.2)} ${n(eye-s.browLift-s.browTilt)}L${n(50+s.eyeGap+3.2)} ${n(eye-s.browLift+s.browTilt)}"/></g>
    <g fill="#18181b"><ellipse cx="${n(50-s.eyeGap)}" cy="${n(eye)}" rx="${n(s.eyeRx)}" ry="${n(s.eyeRy)}"/><ellipse cx="${n(50+s.eyeGap)}" cy="${n(eye)}" rx="${n(s.eyeRx)}" ry="${n(s.eyeRy)}"/></g>
    <path d="M50 ${n(eye+2)}l${n(-1-s.nose)} 5h3" fill="none" stroke="${rgb(face.skin,.75)}" stroke-linecap="round"/>
    <path d="M${n(50-s.mouthW)} ${n(mouth)}Q50 ${n(mouth+s.mouthCurve*2)} ${n(50+s.mouthW)} ${n(mouth)}Q50 ${n(mouth+s.mouthCurve*2+s.mouthOpen*5)} ${n(50-s.mouthW)} ${n(mouth)}Z" fill="#18181b" stroke="#18181b" stroke-width="1.2"/>
    <g fill="none" stroke="#18181b" stroke-width="1.3" opacity="${n(s.glasses)}"><circle cx="${n(50-s.eyeGap)}" cy="${n(eye)}" r="${n(glass)}"/><circle cx="${n(50+s.eyeGap)}" cy="${n(eye)}" r="${n(glass)}"/><path d="M${n(50-s.eyeGap+glass)} ${n(eye)}h${n(s.eyeGap*2-glass*2)}"/></g>
  </svg>`;
}
function disbitFaceHtml(seed) { return disbitFaceSvg(createDisbitFace(seed)); }

let facePickerBatch = 0;
function mountFacePicker() {
  let picker = document.getElementById('face-picker');
  if (!picker) {
    picker = document.createElement('section'); picker.id = 'face-picker'; picker.className = 'face-picker';
    picker.innerHTML = '<div class="face-picker-head"><h3>Твой персонаж</h3><button type="button" class="row-btn" id="face-shuffle">Ещё лица</button></div><div class="face-options" role="group" aria-label="Варианты портрета"></div><p class="hint">Выбор сохранится только после кнопки «Сохранить».</p>';
    document.querySelector('#profile-overlay .avatar-preview').after(picker);
    document.getElementById('face-shuffle').onclick = () => { facePickerBatch++; fillFaceChoices(); };
  }
  fillFaceChoices();
}
function fillFaceChoices() {
  const box = document.querySelector('#face-picker .face-options'); if (!box) return;
  box.replaceChildren();
  const used = new Set();
  for (let i=0;i<5;i++) {
    let candidate = i * 7;
    let seed = i===0 && avaDraft.mark?.startsWith('face:') ? avaDraft.mark.slice(5) : `disbit-${facePickerBatch}-${candidate}`;
    while (used.has(seed)) seed = `disbit-${facePickerBatch}-${++candidate}`;
    used.add(seed);
    const button = document.createElement('button'); button.type='button'; button.dataset.face=seed;
    button.setAttribute('aria-label', `Портрет ${i+1}`); button.innerHTML=disbitFaceHtml(seed);
    button.onclick = event => {
      avaDraft.mark='face:'+seed; avaDraft.photo=null; avaDraft.emoji=null;
      updateAvaPreview(); buildMarkPicker();
      const preview = document.getElementById('ava-preview'); preview.getAnimations().forEach(a=>a.cancel());
      if (event.detail && !motionReduced()) preview.animate([{opacity:.5,transform:'scale(.95) rotateY(-12deg)'},{opacity:1,transform:'scale(1) rotateY(0)'}],{duration:220,easing:'cubic-bezier(.23,1,.32,1)'});
    };
    box.append(button);
  }
  syncFacePicker();
}
function syncFacePicker() {
  document.querySelectorAll('[data-face]').forEach(button => button.setAttribute('aria-pressed', String(!avaDraft.photo && avaDraft.mark === 'face:'+button.dataset.face)));
}
