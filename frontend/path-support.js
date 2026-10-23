/* Settings, truthful availability and local data tools. No payment/native simulation. */
let supportSyncBusy = false;
let supportSyncError = '';
let supportRestoreBusy = false;
let notifPermission = '';
let notifBusy = false;
let notifScheduleError = '';
let notifSyncRunning = false;
let notifSyncAgain = false;
async function syncNotifications() {
  if (!notifPlugin()) return;
  if (notifSyncRunning) { notifSyncAgain = true; return; }
  notifSyncRunning = true;
  try { do { notifSyncAgain = false; await scheduleNotifications(); } while (notifSyncAgain); }
  finally { notifSyncRunning = false; renderNotifPermission(); }
}
function reducedMotion() {
  return settings.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function applyMotion() {
  document.documentElement.dataset.motion = reducedMotion() ? 'reduce' : 'full';
  const select = document.getElementById('set-motion');
  if (select) select.value = settings.motion === 'reduce' ? 'reduce' : 'system';
  const hint = document.getElementById('motion-hint');
  if (hint) hint.textContent = reducedMotion() ? 'Движение уменьшено. Отметки, прогресс и результаты сохраняются.' : 'Короткие переходы. Уменьшение движения в системе всегда имеет приоритет.';
  if (reducedMotion()) document.getAnimations().forEach(a => { try { a.finish(); } catch { a.cancel(); } });
}
function renderConnection() {
  const box = document.getElementById('connection-state');
  if (!box) return;
  const offline = !navigator.onLine;
  box.hidden = !offline && !supportSyncError && !supportSyncBusy;
  box.querySelector('p').textContent = offline
    ? 'Нет сети. Показаны сохранённые данные. Серверные действия недоступны; изменения настроек пока только на устройстве.'
    : supportSyncBusy ? 'Обновляем данные аккаунта…' : supportSyncError;
  const retry = box.querySelector('button');
  retry.hidden = offline || supportSyncBusy || !authToken;
  retry.disabled = supportSyncBusy;
}
function syncFailure(message = 'Не удалось синхронизировать данные. Сохранённая копия остаётся на устройстве.') {
  supportSyncError = message;
  renderConnection();
}
async function apiBootstrap() {
  if (supportSyncBusy || !API || !authToken) { renderConnection(); return; }
  if (!navigator.onLine) { syncFailure(); return; }
  supportSyncBusy = true; supportSyncError = ''; renderConnection();
  try { await bootstrapData(); }
  catch { syncFailure(); }
  finally { supportSyncBusy = false; renderConnection(); }
}
function dataStatus(message, error = false) {
  const el = document.getElementById('data-status');
  el.textContent = message; el.dataset.error = String(error); el.hidden = false;
  el.focus({ preventScroll:true });
}
function validateBackup(data) {
  const record = v => v && typeof v === 'object' && !Array.isArray(v);
  const bad = message => { throw Error(message); };
  if (!record(data) || data.app !== 'disbit' || !Number.isInteger(data.version) || data.version < 1 || data.version > 5) bad('Нужен JSON-экспорт disbit версии 1–5.');
  // Reject unsafe dictionary keys before any merge, even in old backups.
  const walk = (v, depth = 0) => {
    if (depth > 24) bad('Слишком сложная структура файла.');
    if (v && typeof v === 'object') Object.entries(v).forEach(([k, item]) => {
      if (['__proto__','constructor','prototype'].includes(k)) bad('Недопустимое поле в файле.');
      walk(item, depth + 1);
    });
  };
  walk(data);
  if (!Array.isArray(data.habits) || data.habits.length > 2000) bad('Неверный список обещаний.');
  const ids = new Set();
  const day = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && dateKey(keyToDate(v)) === v;
  for (const h of data.habits) {
    if (!record(h) || typeof h.id !== 'string' || !/^[\w-]{1,120}$/.test(h.id) || ids.has(h.id) || typeof h.name !== 'string' || !h.name.trim() || h.name.length > 500) bad('Неверное обещание или повторяющийся идентификатор.');
    ids.add(h.id);
    if (h.archived != null && typeof h.archived !== 'boolean') bad('Неверное состояние архива.');
    if (h.archivePeriods != null && (!Array.isArray(h.archivePeriods) || h.archivePeriods.some(p => !record(p) || !day(p.from) || (p.to !== null && (!day(p.to) || p.to < p.from))))) bad('Неверная история архива.');
    if (!record(h.goal) || !['check','count'].includes(h.goal.type) || !record(h.stake) || !['money','lock'].includes(h.stake.mode)) bad('В обещании отсутствуют условия.');
    if (h.goal.type === 'count' && (!Number.isFinite(h.goal.target) || h.goal.target <= 0)) bad('Неверная цель счётчика.');
    if (h.stake.amount != null && (!Number.isFinite(h.stake.amount) || h.stake.amount < 0)) bad('Неверная сумма в условиях.');
    if (h.stake.apps != null && (!Array.isArray(h.stake.apps) || h.stake.apps.some(v=>typeof v!=='string'))) bad('Неверный список приложений.');
    if (h.goal.unit != null && typeof h.goal.unit !== 'string') bad('Неверная единица измерения.');
    if (h.createdAt && !day(h.createdAt)) bad('Неверная дата обещания.');
    if (h.schedule != null && (!Array.isArray(h.schedule) || h.schedule.some(n => !Number.isInteger(n) || n < 0 || n > 6))) bad('Неверное расписание.');
    for (const key of ['history','counts']) if (h[key] != null) {
      if (!record(h[key])) bad('Неверная история обещания.');
      for (const [d, value] of Object.entries(h[key])) {
        if (!day(d) || (key === 'history' ? ![true,false,0,1,'min','skip'].includes(value) : !Number.isFinite(value) || value < 0)) bad('Неверная отметка в истории.');
      }
    }
    for (const key of ['icon','color','min','buddy']) if (h[key] != null && typeof h[key] !== 'string') bad('Неверное оформление обещания.');
    migrate(h);
  }
  for (const key of ['ledger','friends','goals','rewards','backlog']) {
    if (data[key] == null) data[key] = [];
    if (!Array.isArray(data[key]) || data[key].length > 20000 || data[key].some(v => !record(v))) bad(`Неверный раздел «${key}».`);
    for (const item of data[key]) {
      for (const field of ['id','habitId']) if (item[field]!=null && (typeof item[field]!=='string' || !/^[\w-]{1,120}$/.test(item[field]))) bad(`Неверный идентификатор в разделе «${key}».`);
      for (const field of ['name','text','icon','scene','color','login','emoji']) if (item[field]!=null && typeof item[field]!=='string') bad(`Неверная подпись в разделе «${key}».`);
      for (const field of ['amount','minutes','progress','days']) if (item[field]!=null && !Number.isFinite(item[field])) bad(`Неверное число в разделе «${key}».`);
    }
  }
  for (const key of ['profile','settings']) {
    if (data[key] == null) data[key] = {};
    if (!record(data[key])) bad(`Неверный раздел «${key}».`);
  }
  const p = data.profile;
  if (p.owned != null && (!Array.isArray(p.owned) || p.owned.some(v => typeof v !== 'string'))) bad('Неверный список открытых предметов.');
  if (p.bit != null && (!Number.isFinite(p.bit) || p.bit < 0)) bad('Неверный баланс битов.');
  for (const key of ['name','photo','emoji','mark','gear','color']) if (p[key] != null && typeof p[key] !== 'string') bad('Неверный профиль.');
  if (p.createdAt != null && !day(p.createdAt)) bad('Неверная дата профиля.');
  if (p.photo && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.photo)) bad('Фото профиля должно быть встроенным изображением JPEG, PNG или WebP.');
  if (p.motivation != null && (!record(p.motivation) || typeof p.motivation.text !== 'string' || !Number.isFinite(p.motivation.level))) bad('Неверная мотивация.');
  if (data.settings.notif != null && !record(data.settings.notif)) bad('Неверные настройки напоминаний.');
  for (const g of data.goals) if (typeof g.name !== 'string' || (g.steps != null && (!Number.isFinite(g.steps) || g.steps < 0)) || (g.habitIds != null && (!Array.isArray(g.habitIds) || g.habitIds.some(id => typeof id !== 'string')))) bad('Неверная цель или марафон.');
  for (const r of data.rewards) if (typeof r.text !== 'string' || !Number.isFinite(r.days) || r.days <= 0) bad('Неверная награда.');
  for (const b of data.backlog) if (typeof b.name !== 'string') bad('Неверная идея.');
  for (const e of data.ledger) if (!day(e.day) || !['money','lock'].includes(e.mode)) bad('Неверная запись истории штрафов.');
  if (data.settled != null && !day(data.settled)) bad('Неверная дата итога.');
  if (data.skips != null && (!record(data.skips) || !Number.isFinite(data.skips.left) || data.skips.left < 0 || !/^\d{4}-\d{2}$/.test(data.skips.month))) bad('Неверные данные пропусков.');
  return data;
}
async function restoreLocalBackup(file) {
  if (supportRestoreBusy) return;
  if (authToken) { dataStatus('Импорт в серверный аккаунт пока недоступен. JSON восстанавливает только локальное пространство; депозит и серверная история не заменяются. Экспорт доступен.', true); return; }
  supportRestoreBusy = true;
  const owner = localStorage.getItem(OWNER_KEY);
  try {
    if (file.size > 5 * 1024 * 1024) throw Error('Файл больше 5 МБ.');
    const data = validateBackup(JSON.parse(await file.text()));
    if (!(await confirmAction('Заменить локальные данные?', `${data.habits.length} обещаний, ${data.goals.length} целей. Текущие обещания, история, профиль и настройки на этом устройстве будут заменены, не объединены. Сначала сохрани экспорт. Сервер и депозит не меняются.`, 'Заменить данные'))) return;
    if (authToken || owner !== localStorage.getItem(OWNER_KEY)) throw Error('Аккаунт изменился. Выбери файл заново.');
    const nextProfile = {name:'',color:COLORS[0],bit:0,owned:[],gear:'',motivation:{level:50,text:''},...data.profile};
    const nextSettings = {showOffday:true,theme:'blue',...data.settings};
    const entries = [[STORAGE_KEY,data.habits],[LEDGER_KEY,data.ledger],[PROFILE_KEY,nextProfile],[SETTINGS_KEY,nextSettings],[FRIENDS_KEY,data.friends],[GOALS_KEY,data.goals],[REWARDS_KEY,data.rewards],[BACKLOG_KEY,data.backlog],[SKIPS_KEY,data.skips || {month:monthKey(),left:SKIPS_PER_MONTH,bought:0}]].map(([k,v])=>[k,JSON.stringify(v)]);
    entries.push([SETTLED_KEY,data.settled || null],[STATE_TS_KEY,String(Date.now())]);
    const previous = entries.map(([k])=>[k,localStorage.getItem(k)]);
    try { for (const [k,v] of entries) v === null ? localStorage.removeItem(k) : localStorage.setItem(k,v); }
    catch (err) { for (const [k,v] of previous) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k,v); } catch {} } throw Error('Не хватает места. Импорт отменён; текущие данные сохранены.'); }
    clearTimeout(statePushTimer);
    habits=data.habits;ledger=data.ledger;profile=nextProfile;settings=nextSettings;friends=data.friends;goals=data.goals;rewards=data.rewards;backlog=data.backlog;skips=JSON.parse(localStorage.getItem(SKIPS_KEY));
    habitDrafts.clear();
    Object.keys(sessionStorage).filter(key=>key.startsWith('disbit-path-draft:')).forEach(key=>sessionStorage.removeItem(key));
    applyTheme();render();renderNotifSettings();scheduleNotifSync();
    dataStatus('Локальные данные восстановлены. На сервер ничего не отправлено.');
  } catch (e) { dataStatus('Импорт не выполнен: '+ (e instanceof SyntaxError ? 'файл не является корректным JSON.' : e.message),true); }
  finally {supportRestoreBusy=false;}
}
async function wipeLocalData() {
  if (!(await confirmAction('Очистить это устройство?', 'Будут удалены локальные обещания, история, профиль, настройки и черновики. Вход завершится. Аккаунт, депозит и данные на сервере останутся и загрузятся при следующем входе. Сначала сохрани экспорт.', 'Очистить устройство'))) return;
  clearTimeout(statePushTimer);clearTimeout(notifTimer);
  const LN=notifPlugin();
  if (LN) {
    try { const pending=await LN.getPending();const ours=(pending.notifications || []).filter(n=>n.id>=NOTIF_MORNING_BASE && n.id<NOTIF_EVENING_BASE+NOTIF_DAYS);if(ours.length)await LN.cancel({notifications:ours.map(({id})=>({id}))}); }
    catch {dataStatus('Не удалось снять напоминания. Очистка отменена; попробуй ещё раз.',true);return;}
  }
  clearUserData();setAuth(null,null);localStorage.removeItem(OWNER_KEY);location.reload();
}
function renderNotifPermission() {
  const status=document.getElementById('notif-status');if(!status)return;
  const unavailable=!notifPlugin();
  document.getElementById('notif-browser').hidden=!unavailable;
  status.textContent=notifBusy?'Проверяем разрешение…':notifPermission==='denied'?'Уведомления запрещены в системе.':notifPermission==='error'?'Не удалось проверить разрешение. Попробуй ещё раз.':notifScheduleError;
  document.getElementById('notif-help').hidden=!['denied','error'].includes(notifPermission) && !notifScheduleError;
  document.getElementById('set-notif').disabled=notifBusy || unavailable;
}
async function checkNotifPermission() {
  const LN=notifPlugin();if(!LN)return;
  try {const p=await LN.checkPermissions();notifPermission=p.display;if(p.display!=='granted' && notifCfg().on)saveNotifCfg({on:false});}
  catch {notifPermission='error';}
  renderNotifPermission();
}
function wireSupportUI() {
  document.getElementById('set-motion').setAttribute('aria-describedby','motion-hint');
  ['set-notif-morning','set-notif-evening'].forEach(id=>{const el=document.getElementById(id);el.name=id;el.autocomplete='off';});
  document.querySelectorAll('svg.ic').forEach(el=>{if(!el.hasAttribute('aria-label'))el.setAttribute('aria-hidden','true');el.setAttribute('focusable','false');});
  const root=document.querySelector('.app');
  const box=document.createElement('section');box.id='connection-state';box.className='connection-state';box.hidden=true;
  box.innerHTML='<p role="status" aria-live="polite"></p><button type="button" class="btn-secondary">Повторить</button>';
  root.querySelector('.header').after(box);box.querySelector('button').onclick=apiBootstrap;
  window.addEventListener('offline',renderConnection);
  window.addEventListener('online',()=>{supportSyncError='Связь восстановлена. Обнови данные аккаунта.';renderConnection();});
  document.getElementById('set-motion').onchange=e=>{settings.motion=e.target.value;saveJson(SETTINGS_KEY,settings);applyMotion();};
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',applyMotion);
  document.addEventListener('keydown',()=>{document.documentElement.dataset.input='keyboard';},true);
  document.addEventListener('pointerdown',()=>{document.documentElement.dataset.input='pointer';},true);
  document.getElementById('notif-check').onclick=async()=>{await checkNotifPermission();await syncNotifications();};
  document.getElementById('capability-open').onclick=()=>openSheet('capability-overlay');
  const states={
    choose:['Выбранные приложения','Приложения не выбраны. Список и длительность появятся после подключения нативной функции.','Выбор пока недоступен'],
    permission:['Доступ не запрошен','Будущий экран объяснит, какой доступ нужен системе и как его отозвать. Сейчас системный запрос не отправляется.','Запрос пока недоступен'],
    active:['Нет активного ограничения','В рабочей версии здесь будут причина, выбранные приложения и время окончания от системы. Сейчас таймер не запускается.','Ограничение не запущено'],
    finished:['Завершение не подтверждено','Результат появится только после подтверждения снятия ограничения системой. Сейчас приложение ничего не блокирует.','Нет завершённого ограничения'],
    revoked:['Доступ не предоставлен','После подключения функции здесь будет объяснение, как отозвать доступ в настройках телефона. Отзыв остановит блокировку.','Отзывать нечего']
  };
  document.querySelectorAll('[data-capability]').forEach(button=>button.onclick=()=>{
    const [title,copy,action]=states[button.dataset.capability];
    document.getElementById('capability-state-title').textContent=title;
    document.getElementById('capability-state-copy').textContent=copy;
    document.getElementById('capability-state-action').textContent=action;
    document.querySelectorAll('[data-capability]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));
  });
  renderConnection();renderNotifPermission();
}
