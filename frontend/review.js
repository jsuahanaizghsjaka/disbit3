let KEY = '';
let status = 'pending';
let mediaUrls = [];
let generation = 0;
const H = () => ({ 'X-Admin-Key': KEY });
async function loadAppeals(){
  const list=document.getElementById('appeals');list.textContent='Загрузка…';
  try{
    const response=await fetch('/api/moderation/appeals/admin',{headers:H()});if(!response.ok)throw Error();
    const data=await response.json();list.replaceChildren();
    for(const item of data.items){
      const card=document.createElement('article');card.className='proof';
      const text=document.createElement('p');text.textContent='@'+item.login+': '+item.message;card.append(text);
      const label=document.createElement('label');label.textContent='Причина решения';label.htmlFor='appeal-reason-'+item.id;
      const reason=document.createElement('textarea');reason.id=label.htmlFor;reason.className='inp';reason.maxLength=1000;card.append(label,reason);
      for(const [status,title] of [['accepted','Снять ограничение'],['rejected','Оставить ограничение']]){
        const button=document.createElement('button');button.className='btn';button.textContent=title;
        button.onclick=async()=>{
          if(reason.value.trim().length<5){reason.focus();return;}
          if(!confirm(title+'?'))return;button.disabled=true;
          try{const saved=await fetch('/api/moderation/appeals/'+item.id+'/decision',{method:'POST',headers:{...H(),'Content-Type':'application/json'},body:JSON.stringify({status,reason:reason.value})});if(!saved.ok)throw Error();await loadAppeals();}catch{alert('Решение не сохранено. Повторите.');button.disabled=false;}
        };card.append(button);
      }list.append(card);
    }if(!data.items.length)list.textContent='Нет ожидающих обращений';
  }catch{list.textContent='Не удалось загрузить обращения';}
}
document.getElementById('appeals-refresh').onclick=loadAppeals;
async function loadReports() {
  const list=document.getElementById('reports');list.textContent='Загрузка…';
  try {
    const r=await fetch('/api/moderation/reports',{headers:H()});if(!r.ok)throw Error('load');
    const {items}=await r.json();list.replaceChildren();
    for(const item of items){
      const box=document.createElement('article');box.className='proof';
      const text=document.createElement('p');text.textContent=`№${item.id} · ${item.target_login || 'Удалённый аккаунт'} · ${item.created_at}: ${item.reason}`;box.append(text);
      for(const [status,label] of [['resolved','Ограничить социальные действия'],['dismissed','Нарушение не найдено']]) {
        const b=document.createElement('button');b.className='btn';b.textContent=label;
        b.onclick=async()=>{b.disabled=true;try{const response=await fetch(`/api/moderation/reports/${item.id}/decision`,{method:'POST',headers:{...H(),'Content-Type':'application/json'},body:JSON.stringify({status})});if(!response.ok)throw Error('save');await loadReports();}catch{b.disabled=false;alert('Решение не сохранено');}};box.append(b);
      }list.append(box);
    }if(!items.length)list.textContent='Нет ожидающих жалоб';
  }catch{list.textContent='Не удалось загрузить жалобы';}
}
document.getElementById('reports-refresh').onclick=loadReports;

async function load() {
  const current = ++generation;
  mediaUrls.forEach(url => URL.revokeObjectURL(url)); mediaUrls = [];
  const list = document.getElementById('list');
  list.innerHTML = '<p class="empty">Загрузка…</p>';
  let data;
  try {
    const r = await fetch('/api/proofs?status=' + status, { headers: H() });
    if (!r.ok) throw new Error('unauth');
    data = await r.json();
    if (current !== generation) return;
  } catch { list.innerHTML = '<p class="empty">Ошибка загрузки</p>'; return; }

  const c = data.counts || {};
  document.getElementById('counts').textContent =
    `Ожидают: ${c.pending || 0} · Одобрены: ${c.approved || 0} · Отклонены: ${c.rejected || 0}`;

  if (!data.items.length) { list.innerHTML = '<p class="empty">Здесь пусто</p>'; return; }
  list.innerHTML = '';
  for (const p of data.items) {
    const el = document.createElement('div');
    el.className = 'proof';
    const media = p.type === 'video'
      ? `<video class="p-media" controls playsinline preload="none"></video>`
      : `<img class="p-media" alt="Фото выполнения обещания">`;
    const actions = status === 'pending'
      ? `<div class="p-actions">
           <button class="btn btn-ok" data-ok="${p.id}">✓ Одобрить</button>
           <button class="btn btn-no" data-no="${p.id}">✕ Отклонить</button>
         </div>`
      : `<span class="badge b-${p.status}">${p.status === 'approved' ? 'одобрен' : 'отклонён'}</span>`;
    el.innerHTML = `
      <div class="p-top">
        <span class="p-habit">${escapeHtml(p.habit_name || 'Обещание')}</span>
        <span class="p-source">${p.source === 'gallery' ? 'Из галереи' : p.source === 'camera' ? 'Камера приложения' : 'Источник не указан'} · способ загрузки указан приложением</span>
        <span class="p-meta">${escapeHtml(p.user_login || 'гость')} · ${p.day}</span>
      </div>
      <button class="btn" data-load ${p.media_deleted ? 'disabled' : ''}>${p.media_deleted ? 'Медиа удалено по сроку хранения' : 'Открыть '+(p.type === 'video' ? 'видео' : 'фото')}</button>
      ${media}
      ${actions}`;
    list.appendChild(el);
    el.querySelector('.p-media').hidden = true;
    el.querySelectorAll('[data-ok],[data-no]').forEach(b=>b.disabled=true);
    const open = el.querySelector('[data-load]');
    open.onclick = () => {
    open.disabled = true; open.textContent = 'Загрузка…';
    fetch('/api/proofs/' + p.id + '/media', { headers: H(), cache: 'no-store' })
      .then(r => { if (!r.ok) throw Error('media'); return r.blob(); })
      .then(blob => { if (current !== generation) return; const url=URL.createObjectURL(blob); mediaUrls.push(url); const viewer=el.querySelector('.p-media'); viewer.src=url; viewer.hidden=false; open.hidden=true; el.querySelectorAll('[data-ok],[data-no]').forEach(b=>b.disabled=false); })
      .catch(() => { if (current === generation) { open.disabled=false;open.textContent='Не удалось загрузить. Повторить'; } });
    };
  }
  list.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => decide(b.dataset.ok, 'approved'));
  list.querySelectorAll('[data-no]').forEach(b => b.onclick = () => decide(b.dataset.no, 'rejected'));
}

async function decide(id, decision) {
  if (!confirm(decision === 'approved' ? 'Подтвердить выполнение?' : 'Отклонить этот пруф?')) return;
  try {
  const response = await fetch('/api/proofs/' + id + '/decision', {
    method: 'POST',
    headers: { ...H(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: decision })
  });
  if (!response.ok) throw Error('decision');
  load();
  } catch { alert('Решение не сохранено. Проверьте подключение и повторите.'); }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

document.getElementById('enter').onclick = async () => {
  KEY = document.getElementById('key').value.trim();
  const err = document.getElementById('gate-err');
  err.hidden=true;
  document.getElementById('enter').disabled=true;
  try {
  const r = await fetch('/api/proofs?status=pending', { headers: H() });
  if (!r.ok) { err.hidden = false; err.textContent = 'Неверный ключ'; return; }
  document.getElementById('key').value = '';
  document.getElementById('gate').hidden = true;
  document.getElementById('panel').hidden = false;
  load();
  loadReports();
  loadAppeals();
  } catch { err.hidden=false;err.textContent='Нет соединения. Попробуйте ещё раз.'; }
  finally { document.getElementById('enter').disabled=false; }
};
document.getElementById('logout').onclick=()=>{ KEY='';generation++;mediaUrls.forEach(url=>URL.revokeObjectURL(url));mediaUrls=[];document.getElementById('list').replaceChildren();document.getElementById('reports').replaceChildren();document.getElementById('panel').hidden=true;document.getElementById('gate').hidden=false;document.getElementById('key').focus(); };
document.getElementById('key').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('enter').click();
});
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('on'));
  t.classList.add('on');
  status = t.dataset.status;
  load();
});

// если ключ уже вводили в этой вкладке — сразу входим
sessionStorage.removeItem('disbit_admin_key');
