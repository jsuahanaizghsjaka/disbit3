/* Visual spec 16–20. Derived views never change the underlying history. */
const calendarLabels = {done:'Всё выполнено', min:'Выполнен минимум', skip:'Грэйс-день', part:'Частично выполнено', fail:'Не выполнено', off:'Не запланировано', plain:'Ожидает выполнения', future:'Будущий день'};
function calendarStatus(d) {
  const key = dateKey(d), scheduled = habits.filter(h => h.createdAt <= key && isScheduledOn(h,d));
  if (key > TODAY) return 'future';
  if (!scheduled.length) return 'off';
  const covered = scheduled.every(h => doneOn(h,key) || isSkipOn(h,key));
  if (covered && scheduled.some(h => isSkipOn(h,key))) return 'skip';
  if (covered && scheduled.some(h => isMinOn(h,key))) return 'min';
  if (covered) return 'done';
  if (scheduled.some(h => doneOn(h,key) || isSkipOn(h,key))) return 'part';
  return key < TODAY && scheduled.some(h => isRequiredOn(h,d)) ? 'fail' : 'plain';
}
function calendarDayDescription(key) {
  const scheduled = habits.filter(h => h.createdAt <= key && isScheduledOn(h,keyToDate(key)));
  return `${formatDay(key)}: ${calendarLabels[calendarStatus(keyToDate(key))]}. Выполнено ${scheduled.filter(h=>doneOn(h,key)).length} из ${scheduled.length}; грэйс-дней ${scheduled.filter(h=>isSkipOn(h,key)).length}.`;
}
const calendarPending = new Set();
const calendarErrors = new Map();
async function saveCalendarMark(h,key,mark,count=h.counts?.[key]||0) {
  const lock=h.id+':'+key, owner=authToken;
  if(calendarPending.has(lock)||pendingHabitMarks.has(h.id)||h.archived||!isEditableDay(key)||isSkipOn(h,key)) return false;
  const wasDone = doneOn(h,key), nextDone = mark===true || mark==='min';
  const focusData={...document.activeElement?.dataset};
  calendarPending.add(lock);calendarErrors.delete(lock);
  if(daySheetKey===key)renderDaySheet();
  try {
    if(nextDone&&!wasDone&&!(await requireCompletionProof(h))) return false;
    if(owner!==authToken||!habits.includes(h))return false;
    if(API&&authToken) {
      const result=await apiCallStrict('PUT',`/habits/${h.id}/day/${key}`,{done:mark===true||mark==='min',minimum:mark==='min',count});
      if(owner!==authToken||!habits.includes(h))return;
      if(result.error){calendarErrors.set(lock,result.error);toast(result.error);return false;}
    }
    h.counts[key]=count;h.history[key]=mark;
    const delta=Number(nextDone)-Number(wasDone);
    h.bit=Math.max(0,(h.bit||0)+delta);save();addBit(delta);
    return true;
  } finally {
    calendarPending.delete(lock);
    if(daySheetKey===key)renderDaySheet();
    render();
    if(daySheetKey===key) {
      const next=[...document.querySelectorAll('#day-body button')].find(b=>Object.keys(focusData).length&&Object.entries(focusData).every(([k,v])=>b.dataset[k]===v));
      next?.focus({preventScroll:true});
    }
  }
}
function renderStatsText() {
  const monday = weekStartOf(new Date());
  document.getElementById('week-text').innerHTML = Array.from({length:7},(_,i)=>{
    const day = addDays(monday,i), key=dateKey(day);
    const scheduled=habits.filter(h=>h.createdAt<=key && isScheduledOn(h,day));
    return `<li><span>${DAY_NAMES[i]}</span><b>${key>TODAY ? 'Позже' : scheduled.length ? `${scheduled.filter(h=>doneOn(h,key)).length} / ${scheduled.length}` : 'Нет плана'}</b></li>`;
  }).join('');
  const box=document.getElementById('heatmap-text');
  const pool=hmFilter==='all'?habits:habits.filter(h=>h.id===hmFilter);
  box.innerHTML=Array.from({length:HEATMAP_WEEKS*7},(_,i)=>{
    const d=addDays(monday,-7*(HEATMAP_WEEKS-1)+i), key=dateKey(d);
    if(key>TODAY) return '';
    const scheduled=pool.filter(h=>h.createdAt<=key && isScheduledOn(h,d));
    return `<li>${formatDay(key)}: ${scheduled.length ? `${scheduled.filter(h=>doneOn(h,key)).length} из ${scheduled.length}` : 'нет плана'}</li>`;
  }).join('');
}
function renderProfileIdentity() {
  document.getElementById('profile-login').textContent=authUser?.login ? '@'+authUser.login : 'Локальный профиль';
}
function appendHabitHistory(h) {
  const details=document.createElement('details');details.className='chart-text';
  const summary=document.createElement('summary');summary.textContent='История этого обещания';details.append(summary);
  const list=document.createElement('ul');
  const days=Object.keys(h.history || {}).sort().reverse();
  list.innerHTML=days.map(key=>`<li>${formatDay(key)}: ${isSkipOn(h,key)?'грэйс-день':isMinOn(h,key)?'минимум':doneOn(h,key)?'выполнено':'не выполнено'}</li>`).join('') || '<li>Отметок пока нет</li>';
  details.append(list);document.getElementById('hstat-body').append(details);
  const charges=ledger.filter(e=>e.habitId===h.id);
  if(charges.length) {
    const history=document.createElement('details');history.className='chart-text';
    history.innerHTML='<summary>Штрафы этого обещания</summary><ul>'+charges.map(e=>`<li>${formatDay(e.day)}: ${escapeHtml(e.name||h.name)}, ${e.mode==='money'?rub(e.amount*100):'старая блокировка'}. ${chargeStatus(e)}</li>`).join('')+'</ul>';
    document.getElementById('hstat-body').append(history);
  }
}
function chargeStatus(e) {return ({charged:'Списано с депозита',failed:'Не списано. Проверь депозит',pending:'Ожидает списания',simulated:'Тестовая запись'})[e.status] || 'Зафиксировано в журнале';}
function renderMotivationRead(editing) {
  const box=document.getElementById('mot-read');
  if(!box) return;
  box.hidden=editing;
  box.textContent=profile.motivation?.text || '';
  document.getElementById('mot-text').hidden=!editing;
  document.getElementById('mot-text-label').hidden=!editing;
  document.querySelector('.motivation-level').classList.toggle('is-reading',!editing);
}

let walletLoading=false, walletError='', walletRequest=0, topupBusy=false;
let topupUncertain=false, paymentReturnNotice='';
function paymentKey() { return `disbit-payment:${authUser?.id || authUser?.login || 'local'}`; }
function pendingPayment() { try { return JSON.parse(sessionStorage.getItem(paymentKey())); } catch { return null; } }
function operationStatus(op) {
  return ({done:'Проведено',pending:'Ожидает подтверждения',failed:'Не выполнено',cancelled:'Отменено',canceled:'Отменено'})[op.status] || 'Статус не получен';
}
function operationDate(value) {
  if(!value) return 'Дата не получена';
  const d=new Date(value.includes('T') ? value : value.replace(' ','T')+'Z');
  return Number.isNaN(d.valueOf())?'Дата не получена':d.toLocaleString('ru-RU',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function operationName(op) { return op.type==='topup'?'Пополнение':op.type==='charge'?'Штраф':op.type==='refund'?'Возврат':'Операция'; }
async function loadWallet() {
  const request=++walletRequest, token=authToken;
  if(!API || !token) { wallet=null; walletLoading=false; walletError=''; renderWallet(); return; }
  walletLoading=true; walletError=''; renderWallet();
  const result=await apiCallStrict('GET','/wallet');
  if(request!==walletRequest || token!==authToken) return;
  walletLoading=false;
  if(result.error || !Number.isFinite(result.balance) || !Array.isArray(result.history)) walletError=result.error || 'Не удалось прочитать депозит. Повтори загрузку.';
  else {
    wallet=result;
    const pending=pendingPayment();
    const matched=pending?.providerId && wallet.history.find(op=>op.provider_id===pending.providerId);
    if(matched && ['done','failed','cancelled','canceled'].includes(matched.status)) {
      sessionStorage.removeItem(paymentKey());
      paymentReturnNotice=matched.status==='done'?'Пополнение подтверждено сервером':`Пополнение: ${operationStatus(matched).toLowerCase()}`;
      toast(paymentReturnNotice);
    }
  }
  renderWallet();
}
function renderWallet() {
  const card=document.getElementById('wallet-card'); if(!card) return;
  card.hidden=false; card.setAttribute('aria-busy',String(walletLoading));
  const signed=!!(API&&authToken), balance=document.getElementById('wallet-balance');
  balance.textContent=signed&&wallet?rub(wallet.balance):signed?'Загружаем…':'Нужен аккаунт';
  balance.classList.toggle('wallet-skeleton',signed&&!wallet&&walletLoading);
  if(signed&&!wallet&&!walletLoading) balance.textContent='Баланс недоступен';
  document.getElementById('wallet-sub').textContent=!signed?'Войди, чтобы открыть депозит':wallet?`Списано штрафов: ${rub(wallet.charged || 0)}`:'Подключись к сети и обнови депозит';
  const simulated=!!wallet?.payments?.simulated;
  document.getElementById('wallet-sim').hidden=!signed||!simulated;
  document.getElementById('wallet-mode').textContent=!signed?'Рубли, отдельно от битов':!wallet?'Режим уточняется':simulated?'Тестовый депозит':'Платёжный провайдер: '+(wallet.payments?.provider || 'не указан');
  const topup=document.getElementById('btn-topup'); topup.textContent=signed?'Пополнить':'Войти'; topup.disabled=signed&&(!wallet||walletLoading||!!walletError||topupBusy||topupUncertain||!!pendingPayment());
  const state=document.getElementById('wallet-state');
  state.textContent=walletLoading?'Обновляем депозит…':walletError?(wallet?'Не удалось обновить. Показаны последние загруженные данные. ':'')+walletError:topupUncertain?'Ответ на пополнение не получен. Не создавай новый платёж, пока результат не уточнён. Обнови историю.':pendingPayment()?'Платёж ещё не подтверждён. Возвращение со страницы оплаты само по себе не означает зачисление.':paymentReturnNotice;
  document.getElementById('wallet-retry').hidden=!signed;
  document.getElementById('wallet-retry').disabled=walletLoading;
  const box=document.getElementById('wallet-history');
  box.innerHTML=!signed||!wallet?'':wallet.history.length?wallet.history.map((op,index)=>`<button class="ledger-row operation-row" data-operation="${index}"><span class="ledger-main"><span class="ledger-name">${operationName(op)}</span><span class="ledger-day">${escapeHtml(op.meta?.name || '')}</span><span class="ledger-day">${operationDate(op.created_at)}</span><span class="operation-status">${operationStatus(op)}</span></span><span class="ledger-amount ${op.amount>0?'plus':''}">${op.amount>0?'+':'−'}${rub(Math.abs(op.amount))}</span></button>`).join(''):'<p class="hint">Операций пока нет. Пополнение появится здесь после подтверждения.</p>';
  box.querySelectorAll('[data-operation]').forEach(b=>b.onclick=()=>openOperation(wallet.history[Number(b.dataset.operation)]));
  document.querySelectorAll('[data-payment-note]').forEach(el=>el.textContent=!signed?'Локальный журнал. Реальные деньги не списываются.':!wallet?'Режим платежей ещё не загружен.':simulated?'Тестовый режим. Реальные деньги не списываются.':'Журнал штрафов. Статус списания смотри в депозите.');
}
function openOperation(op) {
  document.getElementById('operation-title').textContent=operationName(op);
  document.getElementById('operation-body').innerHTML=`<p class="operation-total ${op.amount>0?'plus':''}">${op.amount>0?'+':'−'}${rub(Math.abs(op.amount))}</p><dl class="operation-details"><dt>Статус</dt><dd>${operationStatus(op)}</dd><dt>Дата</dt><dd>${operationDate(op.created_at)}</dd><dt>Обещание</dt><dd>${escapeHtml(op.meta?.name || 'Не связано с обещанием')}</dd><dt>После операции</dt><dd>${rub(op.balance_after)}</dd><dt>Режим</dt><dd>${op.meta?.test||op.provider==='manual'?'Тестовый, без реальных денег':escapeHtml(op.provider || 'Списание с депозита')}</dd></dl><p class="hint">${op.type==='charge'?'Штраф за невыполнение. Изменение отметки не отменяет зафиксированную операцию.':'Пополнение отображается по данным сервера, а не по возвращению со страницы оплаты.'}</p>`;
  openSheet('operation-overlay');
}
function openTopupSheet() {
  if(!API||!authToken) { openAuthSheet('login'); return; }
  if(!wallet||walletError||topupBusy||topupUncertain||pendingPayment()) return;
  document.getElementById('topup-error').hidden=true;
  document.getElementById('topup-custom').value='';
  document.getElementById('topup-mode').textContent=wallet.payments?.simulated?'Тестовое пополнение. С карты ничего не спишется.':'Перейдёшь к платёжному провайдеру. Зачисление появится после подтверждения.';
  document.getElementById('topup-go').textContent=wallet.payments?.simulated?'Зачислить тестовые ₽':'Перейти к оплате';
  openSheet('topup-overlay');
}
async function doTopup() {
  if(topupBusy||topupUncertain||pendingPayment()||!authToken) return;
  const input=document.getElementById('topup-custom'), raw=input.value;
  const kop=raw!==''?Math.round(Number(raw)*100):Number(document.querySelector('#topup-amounts .on')?.dataset.sum || 30000);
  const err=document.getElementById('topup-error');
  err.hidden=true;
  if(!Number.isFinite(kop)||kop<5000||kop>5000000) {err.textContent='Введи сумму от 50 до 50 000 ₽';err.hidden=false;input.setAttribute('aria-invalid','true');input.focus();return;}
  topupBusy=true; const owner=authToken, btn=document.getElementById('topup-go');
  btn.disabled=true;btn.textContent='Отправляем…';btn.setAttribute('aria-busy','true');
  try {
    const result=await apiCallStrict('POST','/wallet/topup',{amount:kop});
    if(owner!==authToken) return;
    if(result.error) {
      // A missing response is not proof that a payment was never created.
      topupUncertain=!result.notSent && (!result.status || result.status>=500);
      err.textContent=result.error+(topupUncertain?' Не повторяй платёж, пока не проверишь историю.':'');err.hidden=false;return;
    }
    if(result.url) {
      const url=new URL(result.url);
      if(url.protocol!=='https:') {err.textContent='Ссылка оплаты недоступна. Проверь историю перед новой попыткой.';err.hidden=false;topupUncertain=true;return;}
      sessionStorage.setItem(paymentKey(),JSON.stringify({providerId:result.providerId,amount:kop}));
      location.assign(url.href);return;
    }
    if(!result.instant) {topupUncertain=true;err.textContent='Ожидаем подтверждение. Проверь историю депозита.';err.hidden=false;return;}
    closeSheet('topup-overlay');await loadWallet();
    toast(result.simulated?`Зачислено ${rub(kop)} в тестовом режиме`:'Пополнение подтверждено');
  } catch {topupUncertain=true;err.textContent='Не удалось получить результат. Проверь историю перед новой попыткой.';err.hidden=false;}
  finally {topupBusy=false;btn.disabled=topupUncertain||!!pendingPayment();btn.removeAttribute('aria-busy');btn.textContent=wallet?.payments?.simulated?'Зачислить тестовые ₽':'Перейти к оплате';renderWallet();}
}

function wireInsightsUI() {
  const $=id=>document.getElementById(id);
  // Keep existing IDs and event handlers; collapse long settings instead of duplicating them.
  const root=$('screen-profile');
  const groups=[['progress','Прогресс',['ach-card','btn-open-stats','btn-open-calendar','mot-text','reward-list']],['money','Деньги',['wallet-card']],['account','Аккаунт',['acc-box']],['settings','Настройки',['set-offday']],['data','Данные и документы',['btn-export']]];
  groups.forEach(([id,title,ids])=>{
    const group=document.createElement('details');group.className='profile-group';group.id='profile-'+id;
    const summary=document.createElement('summary');summary.textContent=title;group.append(summary);
    root.insertBefore(group,root.querySelector('.about-note'));
    ids.forEach(id=>{const card=$(id)?.closest('.card');if(card)group.append(card);});
  });
  ['btn-open-stats','btn-open-calendar'].forEach(id=>{const card=$(id).closest('section');card.querySelectorAll('h3,p').forEach(el=>el.remove());});
  $('wallet-retry').onclick=loadWallet;
  $('operation-close').onclick=()=>closeSheet('operation-overlay');
  $('topup-custom').addEventListener('input',()=>{$('topup-custom').removeAttribute('aria-invalid');$('topup-error').hidden=true;});
  document.querySelectorAll('#topup-amounts button').forEach(b=>b.addEventListener('click',()=>queueMicrotask(()=>document.querySelectorAll('#topup-amounts button').forEach(c=>c.setAttribute('aria-pressed',String(c.classList.contains('on')))))));
  ['li-id','li-pass','rg-login','rg-email','rg-pass','verify-code','topup-custom','mot-text','rw-days','rw-text','idea-name'].forEach(id=>{const el=$(id);el.name=id;if(!el.autocomplete)el.autocomplete='off';});
  ['li-id','rg-login','rg-email','verify-code'].forEach(id=>{$(id).spellcheck=false;$(id).setAttribute('autocapitalize','none');});
  $('verify-code').autocomplete='one-time-code';
  ['auth-error','verify-error','topup-error'].forEach(id=>{$(id).setAttribute('role','alert');$(id).tabIndex=-1;});
  $('mot-text').setAttribute('aria-describedby','mot-private');
  document.querySelectorAll('#auth-overlay input').forEach(el=>el.addEventListener('input',()=>{el.removeAttribute('aria-invalid');$('auth-error').hidden=true;}));
  $('auth-tabs').addEventListener('click',()=>{$('auth-error').hidden=true;});
  document.querySelectorAll('[data-eye]').forEach(b=>b.addEventListener('click',()=>queueMicrotask(()=>b.setAttribute('aria-label',$(b.dataset.eye).type==='password'?'Показать пароль':'Скрыть пароль'))));
  const params=new URLSearchParams(location.search);
  if(params.has('paid')) {
    paymentReturnNotice='Ты вернулся со страницы оплаты. Сверь результат с историей операций.';
    params.delete('paid');history.replaceState(null,'',location.pathname+(params.size?'?'+params:'')+'#profile');$('profile-money').open=true;
  }
}
