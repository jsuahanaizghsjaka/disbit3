/* Pending/undo/commit interaction adapted from KokonutUI Undo Button (MIT).
 * No DELETE request: archived habits retain completions, IDs and marathon links. */
'use strict';
function habitPausedOn(habit, day) {
  return Array.isArray(habit.archivePeriods) && habit.archivePeriods.some(p => day >= p.from && (!p.to || day < p.to));
}
let pendingArchive = null;
let archiveBusy = false;
function wireArchiveUI() {
  const group = document.createElement('details'); group.id = 'profile-archive'; group.className = 'profile-group motion-account-row';
  group.innerHTML = `<summary>${icon('i-bookmark')}<span>Архив обещаний</span></summary><div class="card"><p class="hint">История и шаги марафонов сохраняются. Пока обещание в архиве, новых обязательных дней нет.</p><div id="archive-list"></div></div>`;
  document.getElementById('profile-data').before(group);
  document.getElementById('detail-archive').onclick = async () => {
    const h = habits.find(h => h.id === hstatId); if (!h || archiveBusy) return;
    if (h.archived) { await setHabitArchived(h.id, false); return; }
    if (pendingArchive) { toast('Сначала отмени или дождись текущей архивации'); return; }
    if (!await confirmAction('Убрать обещание в архив?', 'С сегодняшнего дня обещание будет на паузе. Выполнения, шаги марафона и прошлые списания останутся. Восстановить можно в профиле.', 'В архив')) return;
    closeSheet('hstat-overlay'); queueHabitArchive(h);
  };
  document.addEventListener('keydown', e => {
    if (pendingArchive && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' &&
        !e.target.closest('input,textarea,select,[contenteditable="true"]')) { e.preventDefault(); cancelHabitArchive(); }
  });
  window.addEventListener('pagehide', cancelHabitArchive);
  renderArchiveList();
}
function cancelHabitArchive() {
  if (!pendingArchive) return;
  cancelAnimationFrame(pendingArchive.frame); pendingArchive.banner.remove(); pendingArchive = null;
}
function queueHabitArchive(h) {
  const banner = document.createElement('div'); banner.className = 'archive-undo'; banner.setAttribute('role', 'region'); banner.setAttribute('aria-label', 'Ожидание архивации');
  const label = document.createElement('span'); label.textContent = `В архив: ${h.name}`; label.setAttribute('role', 'status');
  const button = document.createElement('button'); button.className = 'btn-ghost'; button.type = 'button'; button.textContent = 'Отменить';
  const track = document.createElement('span'); track.className = 'archive-countdown'; track.setAttribute('aria-hidden', 'true');
  banner.append(label, button, track); document.body.append(banner); button.onclick = cancelHabitArchive;
  const pending = {id:h.id, token:authToken, banner, remaining:5000, last:performance.now(), frame:0, hover:false}; pendingArchive = pending;
  banner.onpointerenter = e => { if (e.pointerType === 'mouse') pending.hover = true; };
  banner.onpointerleave = () => { pending.hover = false; };
  // Pause while hovered/focused/hidden so the user always has five usable seconds.
  function tick(now) {
    if (pendingArchive !== pending) return;
    if (authToken !== pending.token || !habits.some(h => h.id === pending.id)) { cancelHabitArchive(); return; }
    if (!document.hidden && !pending.hover && !banner.contains(document.activeElement)) pending.remaining -= Math.min(100, now - pending.last);
    pending.last = now; track.style.transform = `scaleX(${Math.max(0,pending.remaining/5000)})`;
    if (pending.remaining <= 0) { cancelHabitArchive(); setHabitArchived(pending.id, true); }
    else pending.frame = requestAnimationFrame(tick);
  }
  pending.frame = requestAnimationFrame(tick);
}
async function setHabitArchived(id, archived) {
  if (archiveBusy) return;
  const h = habits.find(h => h.id === id); if (!h) return;
  archiveBusy = true; const token = authToken; renderArchiveList();
  try {
    let next;
    if (API && authToken) {
      next = await apiCallStrict('PUT', `/habits/${id}/archive`, {archived,day:TODAY});
      if (token !== authToken) return;
      if (next.error) {
        // A lost response may hide a successful operation. Reconcile, never claim success.
        const remote = await apiCallStrict('GET', '/habits?includeArchived=1');
        if (token !== authToken) return;
        const actual = Array.isArray(remote) && remote.find(x => x.id === id);
        if (!actual || actual.archived !== archived) { toast(next.error); return; }
        next = actual;
      }
    } else {
      next = structuredClone(h); next.archived = archived; next.archivePeriods ||= [];
      if (archived) next.archivePeriods.push({from:TODAY,to:null});
      else if (next.archivePeriods.at(-1)?.to === null) next.archivePeriods.at(-1).to = TODAY;
    }
    if (token !== authToken || !habits.includes(h)) return;
    Object.assign(h, next); save(); render(); renderProfile();
    if (!document.getElementById('hstat-overlay').hidden) renderHabitStats();
    toast(archived ? 'Обещание в архиве. История сохранена' : 'Обещание восстановлено');
  } finally { archiveBusy = false; renderArchiveList(); }
}
function renderArchiveList() {
  const list = document.getElementById('archive-list'); if (!list) return;
  const archived = habits.filter(h => h.archived); list.replaceChildren();
  if (!archived.length) { const p=document.createElement('p'); p.className='hint'; p.textContent='Здесь появятся обещания на паузе.'; list.append(p); return; }
  archived.forEach(h => {
    const row = document.createElement('div'); row.className = 'archive-row';
    const text = document.createElement('span'); text.textContent = h.name;
    const button = document.createElement('button'); button.type='button'; button.className='row-btn'; button.textContent='Восстановить';
    button.setAttribute('aria-label', `Восстановить: ${h.name}`); button.disabled=archiveBusy;
    button.onclick=()=>setHabitArchived(h.id,false); row.append(text,button); list.append(row);
  });
}
