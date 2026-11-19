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
  if(op.type==='charge'&&op.status==='failed'&&op.provider==='yookassa') return 'Не удержано: не хватило депозита';
  if(op.type==='refund'&&op.status==='pending') return 'Отправляется на карту';
  return ({done:'Проведено',succeeded:'Проведено',created:'Создано',pending:'Ожидает подтверждения',failed:'Не выполнено',partial:'Возвращено частично',cancelled:'Отменено',canceled:'Отменено'})[op.status] || 'Статус не получен';
}
// Live deposit through the Disbit YooKassa shop (server PAYMENTS_PROVIDER=yookassa).
function liveMoney() { return !!wallet?.payments?.live; }
function legalCurrent() { return wallet?.legal?.current!==false; }
function liveTopupKey() { return `disbit-live-topup:${authUser?.id || authUser?.login || 'local'}`; }
function liveTopupRequest() { try { return JSON.parse(localStorage.getItem(liveTopupKey())); } catch { return null; } }
function setLiveTopupRequest(value) { try { value?localStorage.setItem(liveTopupKey(),JSON.stringify(value)):localStorage.removeItem(liveTopupKey()); } catch {} }
let operationDateZone;
let operationDateFormatter;
function operationDate(value) {
  if(!value) return 'Дата не получена';
  const d=new Date(value.includes('T') ? value : value.replace(' ','T')+'Z');
  if (Number.isNaN(d.valueOf())) return 'Дата не получена';
  if (!operationDateFormatter || operationDateZone !== clientTimeZone) {
    operationDateZone = clientTimeZone;
    operationDateFormatter = new Intl.DateTimeFormat('ru-RU',{timeZone:clientTimeZone,day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
  }
  return operationDateFormatter.format(d);
}
function operationName(op) { return op.type==='topup'?'Пополнение':op.type==='charge'?(op.provider==='yookassa'?'Неустойка':'Штраф'):op.type==='refund'?'Возврат на карту':op.type==='correction'?'Возврат неустойки':'Операция'; }
function operationSettled(op) { return op.status==='done'||op.status==='succeeded'; }
function operationAmount(op) {
  const amount=rub(Math.abs(op.amount));
  if(!operationSettled(op)) return `Запрос: ${amount}`;
  return `${op.amount>0?'+':op.amount<0?'−':''}${amount}`;
}
function operationAmountClass(op) { return !operationSettled(op)?'neutral':op.amount>0?'plus':''; }
function operationRow(op,index,detailed=false) {
  return `<button class="ledger-row operation-row" type="button" data-operation="${index}" aria-label="${operationName(op)}, ${operationAmount(op)}, ${operationDate(op.created_at)}, ${operationStatus(op)}. Подробнее">
    <span class="ledger-main"><span class="ledger-name">${operationName(op)}</span>
    ${op.meta?.name?`<span class="ledger-day">${escapeHtml(op.meta.name)}</span>`:''}
    <span class="ledger-day">${operationDate(op.created_at)}</span>
    <span class="operation-status">${operationStatus(op)}${detailed&&op.balance_after!=null?' · Остаток '+rub(op.balance_after):''}</span></span>
    <span class="ledger-amount ${operationAmountClass(op)}">${operationAmount(op)}</span></button>`;
}
let operationHistory=[], operationHistoryOffset=0, operationHistoryHasMore=false;
let operationHistoryLoading=false, operationHistoryError='', operationHistoryRequest=0, operationHistorySandbox=false;
let operationHistoryRendered=0;
function renderOperationHistory() {
  const list=document.getElementById('operations-list'); if(!list) return;
  const signed=!!(API&&authToken);
  document.getElementById('operations-mode').textContent=!signed?'Войди в аккаунт, чтобы увидеть историю':operationHistorySandbox?'Тестовый депозит ЮKassa':'Депозит';
  if(operationHistoryRendered>operationHistory.length) {
    list.replaceChildren(); operationHistoryRendered=0;
  }
  if(operationHistoryRendered<operationHistory.length) {
    list.insertAdjacentHTML('beforeend',operationHistory.slice(operationHistoryRendered)
      .map((op,index)=>operationRow(op,operationHistoryRendered+index,true)).join(''));
    operationHistoryRendered=operationHistory.length;
  }
  list.setAttribute('aria-busy',String(operationHistoryLoading));
  const state=!signed?'История доступна после входа.'
    :operationHistoryError|| (operationHistoryLoading?'Загружаем операции…'
      :operationHistoryHasMore?'Есть более ранние операции.'
      :operationHistory.length?'Показаны все операции.':'Операций пока нет.');
  document.getElementById('operations-state').textContent=state;
  const more=document.getElementById('operations-more');
  more.hidden=!signed||(!operationHistoryHasMore&&!operationHistoryError);
  more.disabled=operationHistoryLoading;
  more.textContent=operationHistoryError?'Повторить загрузку':'Показать ещё';
}
async function loadOperationHistory(reset=false) {
  if(reset) {
    operationHistoryRequest++;
    operationHistory=[]; operationHistoryOffset=0; operationHistoryHasMore=false;
    operationHistoryError=''; operationHistoryLoading=false;
    operationHistorySandbox=!!wallet?.sandbox?.available;
  }
  if(!API||!authToken||operationHistoryLoading) { renderOperationHistory(); return; }
  const request=++operationHistoryRequest, token=authToken;
  operationHistoryLoading=true; operationHistoryError=''; renderOperationHistory();
  const result=await apiCallStrict('GET',`/wallet/history?offset=${operationHistoryOffset}`);
  if(request!==operationHistoryRequest||token!==authToken) return;
  operationHistoryLoading=false;
  if(result.error||!Array.isArray(result.history)) operationHistoryError=result.error||'Не удалось загрузить историю. Повтори попытку.';
  else {
    const known=new Set(operationHistory.map(op=>String(op.id)));
    for(const op of result.history) if(!known.has(String(op.id))) {
      operationHistory.push(op); known.add(String(op.id));
    }
    operationHistoryOffset=result.offset;
    operationHistoryHasMore=!!result.hasMore;
    operationHistorySandbox=!!result.sandbox;
  }
  renderOperationHistory();
}
async function loadWallet() {
  const request=++walletRequest, token=authToken;
  if(!API || !token) { wallet=null; walletLoading=false; walletError=''; renderWallet(); return; }
  walletLoading=true; walletError=''; renderWallet();
  const waiting=pendingPayment();
  if(waiting?.mode==='sandbox') {
    const check=waiting.providerId
      ? await apiCallStrict('GET',`/wallet/sandbox/status/${encodeURIComponent(waiting.intentId)}`)
      : await apiCallStrict('POST','/wallet/sandbox/topup',{amount:waiting.amount,requestId:waiting.requestId});
    if(request!==walletRequest || token!==authToken) return;
    if(!check.error) {
      topupUncertain=false;
      if(['succeeded','canceled'].includes(check.status)) {
        sessionStorage.removeItem(paymentKey());topupUncertain=false;
        paymentReturnNotice=check.status==='succeeded'?'Тестовый платёж подтверждён ЮKassa':'Тестовый платёж отменён';
      } else sessionStorage.setItem(paymentKey(),JSON.stringify({...waiting,intentId:check.id,providerId:check.providerId,url:check.url}));
    } else if(check.status===404) sessionStorage.removeItem(paymentKey());
  }
  const result=await apiCallStrict('GET','/wallet');
  if(request!==walletRequest || token!==authToken) return;
  if(!result.error && result.payments?.live) await settleLiveTopupRequest(result);
  if(request!==walletRequest || token!==authToken) return;
  walletLoading=false;
  if(result.error || !Number.isFinite(result.balance) || !Array.isArray(result.history)) walletError=result.error || 'Не удалось прочитать депозит. Повтори загрузку.';
  else {
    const before=wallet;
    wallet=result;
    if(result.payments?.live) { liveWalletNotice(before,result); renderWallet(); return; }
    const pending=pendingPayment();
    const matched=pending?.mode!=='sandbox' && pending?.providerId && wallet.history.find(op=>op.provider_id===pending.providerId);
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
  renderRefund();
  document.getElementById('wallet-legal').hidden=!(signed&&liveMoney()&&!legalCurrent());
  if(signed&&liveMoney()) { renderLiveWallet(); return; }
  const sandboxMode=!!wallet?.sandbox?.available;
  const shownBalance=sandboxMode?wallet.sandbox.balance:wallet?.balance;
  balance.textContent=signed&&wallet?rub(shownBalance):signed?'Загружаем…':'Нужен аккаунт';
  balance.classList.toggle('wallet-skeleton',signed&&!wallet&&walletLoading);
  if(signed&&!wallet&&!walletLoading) balance.textContent='Баланс недоступен';
  const simulated=!!wallet?.payments?.simulated || sandboxMode;
  const unavailable=!!wallet&&!sandboxMode&&wallet.payments?.available!==true;
  document.getElementById('wallet-sub').textContent=!signed?'Войди, чтобы открыть депозит':sandboxMode?'Тестовые ₽ не покрывают штрафы':wallet?`${unavailable?'Учтено условных штрафов':'Списано штрафов'}: ${rub(wallet.charged || 0)}`:'Подключись к сети и обнови депозит';
  const simNote=document.getElementById('wallet-sim');
  simNote.hidden=!signed||!(simulated||unavailable);
  if(sandboxMode) simNote.textContent='Тестовый магазин ЮKassa: реальные деньги не списываются. Этот остаток нельзя вывести или использовать для настоящих штрафов.';
  else simNote.textContent='Реальные платежи пока не подключены. Показанные суммы — внутренние записи приложения.';
  document.getElementById('wallet-mode').textContent=!signed?'Рубли, отдельно от битов':!wallet?'Режим уточняется':sandboxMode?'Тестовый депозит ЮKassa':unavailable?'Пополнение и возврат пока недоступны':simulated?'Тестовый депозит':'Платёжный провайдер подключён';
  const pending=pendingPayment();
  const canResume=sandboxMode&&pending?.mode==='sandbox'&&!!pending.url;
  const topup=document.getElementById('btn-topup'); topup.textContent=!signed?'Войти':!wallet?'Загружаем депозит…':unavailable?'Пополнение недоступно':canResume?'Продолжить оплату':sandboxMode?'Тестовое пополнение':'Пополнить'; topup.disabled=signed&&(unavailable||!wallet||walletLoading||!!walletError||topupBusy||topupUncertain|| (!!pending&&!canResume));
  topup.setAttribute('aria-describedby','wallet-mode wallet-state');
  const state=document.getElementById('wallet-state');
  state.textContent=walletLoading?'Обновляем депозит…':walletError?(wallet?'Не удалось обновить. Показаны последние загруженные данные. ':'')+walletError:topupUncertain?'Ответ на пополнение не получен. Не создавай новый платёж, пока результат не уточнён. Обнови историю.':pending?'Платёж ещё не подтверждён. Возвращение со страницы оплаты само по себе не означает зачисление.':paymentReturnNotice;
  document.getElementById('wallet-retry').hidden=!signed;
  document.getElementById('wallet-retry').disabled=walletLoading;
  const box=document.getElementById('wallet-history');
  const shownHistory=sandboxMode?wallet.sandbox.history:wallet?.history || [];
  box.innerHTML=!signed||!wallet?'':shownHistory.length?shownHistory.slice(0,2).map((op,index)=>operationRow(op,index)).join(''):'<p class="hint">Операций пока нет. Пополнение появится здесь после подтверждения.</p>';
  box.querySelectorAll('[data-operation]').forEach(b=>b.onclick=()=>openOperation(shownHistory[Number(b.dataset.operation)]));
  document.querySelectorAll('[data-payment-note]').forEach(el=>el.textContent=!signed?'Локальный журнал. Реальные деньги не списываются.':!wallet?'Режим платежей ещё не загружен.':unavailable||simulated?'Реальные деньги не списываются. Суммы показаны для внутреннего учёта.':'Журнал штрафов. Статус списания смотри в депозите.');
}
function operationNote(op) {
  if(op.provider==='yookassa') {
    if(op.type==='charge') return op.status==='done'
      ? 'Неустойка по денежному условию. Заявку на пересмотр можно подать в течение 30 дней на disbitx1@gmail.com, ответ — в течение 10 дней.'
      : 'Неустойка не удержана: на депозите не хватило денег. Долга не возникает.';
    if(op.type==='refund') return 'Возврат на карту, с которой было пополнение. Отправляется в течение 5 рабочих дней, срок зачисления зависит от банка.';
    if(op.type==='correction') return 'Неустойка возвращена в депозит после пересмотра.';
    return 'Зачисление — только после подтверждения ЮKassa. Чек придёт на почту аккаунта.';
  }
  return op.type==='charge'?'Штраф за невыполнение. Изменение отметки не отменяет зафиксированную операцию.':op.type==='refund'?'Возврат остатка по данным сервера.':'Пополнение отображается по данным сервера, а не по возвращению со страницы оплаты.';
}
function openOperation(op) {
  document.getElementById('operation-title').textContent=operationName(op);
  document.getElementById('operation-body').innerHTML=`<p class="operation-total ${operationAmountClass(op)}">${operationAmount(op)}</p><dl class="operation-details"><dt>Статус</dt><dd>${operationStatus(op)}</dd><dt>Дата</dt><dd>${operationDate(op.created_at)}</dd><dt>Обещание</dt><dd>${escapeHtml(op.meta?.name || 'Не связано с обещанием')}</dd><dt>После операции</dt><dd>${op.balance_after==null?(operationSettled(op)?'Не указан':'Не проведена') :rub(op.balance_after)}</dd><dt>Режим</dt><dd>${op.meta?.test||op.provider==='manual'||op.provider==='yookassa-test'?'Тестовый, без реальных денег':op.provider==='yookassa'?'ЮKassa':escapeHtml(op.provider || 'Списание с депозита')}</dd>${op.meta?.day?`<dt>День</dt><dd>${escapeHtml(op.meta.day)}</dd>`:''}${op.meta?.fee?`<dt>Комиссия</dt><dd>${rub(op.meta.fee)} (не возвращается)</dd>`:''}${op.provider_id?`<dt>ID платежа</dt><dd>${escapeHtml(String(op.provider_id))}</dd>`:''}</dl><p class="hint">${operationNote(op)}</p>`;
  openSheet('operation-overlay');
}
function openTopupSheet() {
  if(!API||!authToken) { openAuthSheet('login'); return; }
  if(liveMoney()) { openLiveTopup(); return; }
  const sandboxMode=!!wallet?.sandbox?.available;
  const pending=pendingPayment();
  if(sandboxMode&&pending?.mode==='sandbox'&&pending.url) {
    try { const url=new URL(pending.url);if(url.protocol==='https:') location.assign(url.href); }
    catch { toast('Ссылка тестовой оплаты недоступна. Обнови депозит.'); }
    return;
  }
  if(!wallet||(!sandboxMode&&wallet.payments?.available!==true)||walletError||topupBusy||topupUncertain||pending) return;
  document.getElementById('topup-error').hidden=true;
  document.getElementById('topup-custom').value='';
  document.getElementById('topup-custom').removeAttribute('aria-invalid');
  document.getElementById('topup-title').textContent=sandboxMode?'Тестовое пополнение':'Пополнить депозит';
  document.getElementById('topup-help').textContent=sandboxMode?'ЮKassa откроет тестовую платёжную страницу. Реальные деньги не спишутся; остаток нельзя вывести или использовать для настоящих штрафов.':'Депозит — обеспечительный платёж: неустойка за невыполненное обещание засчитывается из него. Карта не привязывается, свободный остаток можно вернуть.';
  document.getElementById('topup-mode').textContent=sandboxMode?'Тестовый магазин ЮKassa':wallet.payments?.simulated?'Тестовое пополнение. С карты ничего не спишется.':'Перейдёшь к платёжному провайдеру. Зачисление появится после подтверждения.';
  document.getElementById('topup-go').textContent=sandboxMode?'Перейти к тестовой оплате':wallet.payments?.simulated?'Зачислить тестовые ₽':'Перейти к оплате';
  updateTopupFee();
  openSheet('topup-overlay');
}
// Same numbers as backend/lib/money-limits.js and the offer, section 5.
const TOPUP_MIN_KOP=100, TOPUP_MAX_KOP=1000000, DEPOSIT_MAX_KOP=10000000;
function topupQuote(kop){const payment=Math.ceil(kop*28/1000),service=Math.ceil(kop*10/1000);return {fee:payment+service,total:kop+payment+service};}
function selectedTopupKop(){const raw=document.getElementById('topup-custom').value;return raw!==''?Math.round(Number(raw)*100):Number(document.querySelector('#topup-amounts .on')?.dataset.sum||30000);}
// The sheet no longer prints the fee breakdown: the total is on the ЮKassa page.
function updateTopupFee(){
  const button=document.getElementById('topup-go');
  if(!button||topupBusy) return;
  const custom=document.getElementById('topup-custom');
  const chips=[...document.querySelectorAll('#topup-amounts .topup-chip')];
  const selected=custom.value!==''?null:chips.find(chip=>chip.classList.contains('on'))||chips.find(chip=>chip.dataset.sum==='30000');
  for(const chip of chips){
    chip.classList.toggle('on',chip===selected);
    chip.setAttribute('aria-pressed',String(chip===selected));
  }
  button.textContent=liveMoney()?'Перейти к оплате':wallet?.sandbox?.available?'Перейти к тестовой оплате':wallet?.payments?.simulated?'Зачислить тестовые ₽':'Перейти к оплате';
}
async function doTopup() {
  if(liveMoney()) return doLiveTopup();
  const sandboxMode=!!wallet?.sandbox?.available;
  if(topupBusy||topupUncertain||pendingPayment()||!authToken||(!sandboxMode&&wallet?.payments?.available!==true)) return;
  const input=document.getElementById('topup-custom'), kop=selectedTopupKop();
  const err=document.getElementById('topup-error');
  err.hidden=true;
  input.removeAttribute('aria-invalid');
  if(!Number.isFinite(kop)||kop<TOPUP_MIN_KOP||kop>TOPUP_MAX_KOP) {err.textContent='Введи сумму от 1 до 10 000 ₽';err.hidden=false;input.setAttribute('aria-invalid','true');input.focus();return;}
  const balanceKop=Number((sandboxMode?wallet?.sandbox?.balance:wallet?.balance)||0);
  if(balanceKop+kop>DEPOSIT_MAX_KOP) {err.textContent=`Депозит не может превышать 100 000 ₽. Можно пополнить ещё на ${rub(Math.max(0,DEPOSIT_MAX_KOP-balanceKop))}.`;err.hidden=false;input.setAttribute('aria-invalid','true');input.focus();return;}
  topupBusy=true; const owner=authToken, btn=document.getElementById('topup-go');
  btn.disabled=true;btn.textContent='Отправляем…';btn.setAttribute('aria-busy','true');
  try {
    const requestId=sandboxMode?crypto.randomUUID():null;
    if(sandboxMode) sessionStorage.setItem(paymentKey(),JSON.stringify({mode:'sandbox',requestId,amount:kop}));
    const result=await apiCallStrict('POST',sandboxMode?'/wallet/sandbox/topup':'/wallet/topup',
      sandboxMode?{amount:kop,requestId}:{amount:kop});
    if(owner!==authToken) return;
    if(result.error) {
      if(sandboxMode&&result.status&&result.status<500) sessionStorage.removeItem(paymentKey());
      // A missing response is not proof that a payment was never created.
      topupUncertain=!result.notSent && (!result.status || result.status>=500);
      err.textContent=result.error+(topupUncertain?' Не повторяй платёж, пока не проверишь историю.':'');err.hidden=false;return;
    }
    if(result.url) {
      const url=new URL(result.url);
      if(url.protocol!=='https:') {err.textContent='Ссылка оплаты недоступна. Проверь историю перед новой попыткой.';err.hidden=false;topupUncertain=true;return;}
      sessionStorage.setItem(paymentKey(),JSON.stringify(sandboxMode
        ? {mode:'sandbox',requestId,intentId:result.id,providerId:result.providerId,url:result.url,amount:kop}
        : {providerId:result.providerId,amount:kop}));
      location.assign(url.href);return;
    }
    if(sandboxMode&&result.status==='succeeded') {
      sessionStorage.removeItem(paymentKey());
      closeSheet('topup-overlay');await loadWallet();
      toast('Тестовый платёж подтверждён ЮKassa');
      return;
    }
    if(!result.instant) {topupUncertain=true;err.textContent='Ожидаем подтверждение. Проверь историю депозита.';err.hidden=false;return;}
    closeSheet('topup-overlay');await loadWallet();
    toast(result.simulated?`Зачислено ${rub(kop)} в тестовом режиме`:'Пополнение подтверждено');
  } catch {topupUncertain=true;err.textContent='Не удалось получить результат. Проверь историю перед новой попыткой.';err.hidden=false;}
  finally {topupBusy=false;btn.disabled=(!sandboxMode&&wallet?.payments?.available!==true)||topupUncertain||!!pendingPayment();btn.removeAttribute('aria-busy');btn.textContent=sandboxMode?'Перейти к тестовой оплате':wallet?.payments?.simulated?'Зачислить тестовые ₽':'Перейти к оплате';renderWallet();}
}

/* ---------- Live deposit ---------- */
async function settleLiveTopupRequest(snapshot) {
  const asked=liveTopupRequest(); if(!asked?.requestId) return;
  if(snapshot.pending?.id===asked.requestId) return;
  const check=await apiCallStrict('GET',`/wallet/topup/${encodeURIComponent(asked.requestId)}`);
  if(check.status===404 || ['succeeded','canceled'].includes(check.status)) setLiveTopupRequest(null);
}
function liveWalletNotice(before,now) {
  const was=before?.payments?.live&&before.pending;
  if(was&&!now.pending) {
    const done=now.history.find(op=>op.id==='p-'+was.id);
    paymentReturnNotice=done?.status==='succeeded'?`Зачислено ${rub(done.amount)}. Чек придёт на почту.`:done?.status==='canceled'?'Платёж отменён, деньги не списаны.':'';
    if(paymentReturnNotice) toast(paymentReturnNotice);
  }
}
function renderLiveWallet() {
  const balance=document.getElementById('wallet-balance');
  balance.classList.remove('wallet-skeleton');
  balance.textContent=rub(wallet.balance);
  document.getElementById('wallet-sub').textContent=wallet.reserved
    ?`Свободно ${rub(wallet.available)} · ${rub(wallet.reserved)} возвращается на карту`
    :`Удержано неустоек: ${rub(wallet.charged||0)}`;
  document.getElementById('wallet-sim').hidden=true;
  document.getElementById('wallet-mode').textContent='Пополнение через ЮKassa · рубли отдельно от битов';
  const pending=wallet.pending, topup=document.getElementById('btn-topup');
  topup.textContent=pending?.url?'Продолжить оплату':pending?'Повторить запрос оплаты':'Пополнить';
  topup.disabled=walletLoading||topupBusy;
  topup.setAttribute('aria-describedby','wallet-mode wallet-state');
  document.getElementById('wallet-state').textContent=walletLoading?'Обновляем депозит…'
    :walletError?'Не удалось обновить. Показаны последние загруженные данные. '+walletError
    :pending?(pending.url?`Пополнение на ${rub(pending.amount)} ждёт оплаты. Зачислим после подтверждения ЮKassa.`:`Ссылка для пополнения на ${rub(pending.amount)} ещё не получена. Повтори запрос оплаты.`)
    :paymentReturnNotice;
  document.getElementById('wallet-retry').hidden=false;
  document.getElementById('wallet-retry').disabled=walletLoading;
  const box=document.getElementById('wallet-history');
  box.innerHTML=wallet.history.length?wallet.history.slice(0,2).map((op,index)=>operationRow(op,index)).join('')
    :'<p class="hint">Операций пока нет. Пополнение появится здесь после подтверждения.</p>';
  box.querySelectorAll('[data-operation]').forEach(b=>b.onclick=()=>openOperation(wallet.history[Number(b.dataset.operation)]));
  document.querySelectorAll('[data-payment-note]').forEach(el=>el.textContent='Журнал пропусков. Неустойка удерживается из депозита только по обещаниям с принятым денежным условием.');
}
function openLiveTopup() {
  const pending=wallet?.pending;
  if(pending?.url) {
    try { const url=new URL(pending.url); if(url.protocol==='https:') { location.assign(url.href); return; } } catch {}
    toast('Ссылка оплаты недоступна. Обнови депозит.'); return;
  }
  if(!legalCurrent()) {
    document.getElementById('profile-money').open=true;
    document.getElementById('wallet-legal').scrollIntoView({block:'center'});
    toast('Сначала прими действующую редакцию соглашения');return;
  }
  if(walletLoading||topupBusy) return;
  document.getElementById('topup-error').hidden=true;
  document.getElementById('topup-custom').value=pending?String(pending.amount/100):'';
  if(pending) setLiveTopupRequest({requestId:pending.id,amount:pending.amount});
  document.getElementById('topup-custom').removeAttribute('aria-invalid');
  document.getElementById('topup-title').textContent='Пополнить депозит';
  document.getElementById('topup-help').textContent='Депозит — обеспечительный платёж: неустойка по обещаниям с денежным условием засчитывается из него. Карта не привязывается, свободный остаток можно вернуть.';
  document.getElementById('topup-mode').textContent='Оплата на странице ЮKassa. Данные карты Disbit не получает.';
  document.getElementById('topup-go').textContent='Перейти к оплате';
  updateTopupFee();
  openSheet('topup-overlay');
}
async function doLiveTopup(retry=true) {
  if(topupBusy||!authToken) return;
  const input=document.getElementById('topup-custom'), kop=selectedTopupKop(), err=document.getElementById('topup-error');
  err.hidden=true; input.removeAttribute('aria-invalid');
  if(!Number.isFinite(kop)||kop<TOPUP_MIN_KOP||kop>TOPUP_MAX_KOP) {err.textContent='Введи сумму от 1 до 10 000 ₽';err.hidden=false;input.setAttribute('aria-invalid','true');input.focus();return;}
  if(Number(wallet?.balance||0)+kop>DEPOSIT_MAX_KOP) {err.textContent=`Депозит не может превышать 100 000 ₽. Можно пополнить ещё на ${rub(Math.max(0,DEPOSIT_MAX_KOP-Number(wallet?.balance||0)))}.`;err.hidden=false;input.setAttribute('aria-invalid','true');input.focus();return;}
  // The same request ID after a lost answer resumes the same payment.
  const asked=liveTopupRequest();
  const requestId=asked?.amount===kop&&asked.requestId?asked.requestId:crypto.randomUUID();
  setLiveTopupRequest({requestId,amount:kop});
  topupBusy=true; const owner=authToken, btn=document.getElementById('topup-go');
  btn.disabled=true;btn.textContent='Создаём платёж…';btn.setAttribute('aria-busy','true');
  try {
    const result=await apiCallStrict('POST','/wallet/topup',{amount:kop,requestId});
    if(owner!==authToken) return;
    if(result.error) {
      if(result.status&&result.status<500) setLiveTopupRequest(null);
      if(result.code==='legal_outdated') {closeSheet('topup-overlay');await loadWallet();toast(result.error);return;}
      err.textContent=result.error;err.hidden=false;
      return;
    }
    if(result.status==='succeeded') {setLiveTopupRequest(null);closeSheet('topup-overlay');await loadWallet();return;}
    // the earlier payment with this request ID expired at ЮKassa — start a fresh one
    if(result.status==='canceled'&&retry) {setLiveTopupRequest(null);topupBusy=false;return await doLiveTopup(false);}
    const url=result.url?new URL(result.url):null;
    if(!url||url.protocol!=='https:') {err.textContent='ЮKassa не вернула ссылку оплаты. Обнови депозит и повтори.';err.hidden=false;return;}
    closeSheet('topup-overlay');
    location.assign(url.href);
  } catch {err.textContent='Не удалось получить ответ. Повтори — второй платёж не создастся.';err.hidden=false;}
  finally {topupBusy=false;btn.disabled=false;btn.removeAttribute('aria-busy');updateTopupFee();renderWallet();}
}
let refundBusy=false;
function refundFree() { return Math.max(0,Number(wallet?.available||0)); }
function renderRefund() {
  const input=document.getElementById('refund-amount'), go=document.getElementById('refund-go');
  const help=document.getElementById('refund-help'), status=document.getElementById('refund-status');
  if(!input) return;
  const live=!!(API&&authToken)&&liveMoney();
  go.hidden=!live; input.disabled=!live||refundBusy||!refundFree();
  if(!live) { help.textContent='Возврат станет доступен после подключения платежей.'; status.textContent='Пока недоступно.'; return; }
  help.textContent='Деньги вернутся на карту, с которой было пополнение. Возврат отправляется в течение 5 рабочих дней, срок зачисления зависит от банка. За возврат комиссии нет; комиссия за пополнение не возвращается.';
  input.max=String(refundFree()/100);
  if(!input.value&&refundFree()) input.placeholder=`До ${rub(refundFree())}`;
  go.disabled=refundBusy||!refundFree();
  if(!refundBusy&&!status.dataset.result) status.textContent=refundFree()?`Свободно для возврата: ${rub(refundFree())}`:'Свободного остатка нет.';
}
async function doRefund() {
  if(refundBusy||!liveMoney()) return;
  const input=document.getElementById('refund-amount'), status=document.getElementById('refund-status');
  const kop=input.value===''?refundFree():Math.round(Number(input.value)*100);
  delete status.dataset.result;
  if(!Number.isFinite(kop)||kop<100||kop>refundFree()) {status.textContent=`Введи сумму от 1 ₽ до ${rub(refundFree())}`;input.setAttribute('aria-invalid','true');input.focus();return;}
  input.removeAttribute('aria-invalid');
  refundBusy=true; renderRefund(); status.textContent='Оформляем возврат…';
  try {
    const result=await apiCallStrict('POST','/wallet/refund',{amount:kop,requestId:crypto.randomUUID()});
    status.dataset.result='1';
    status.textContent=result.error?result.error:result.status==='succeeded'?`Возврат ${rub(kop)} отправлен на карту. Срок зачисления зависит от банка.`
      :result.status==='failed'?'Платёжный сервис отклонил возврат. Сумма снова свободна, мы свяжемся с тобой.'
      :`Возврат ${rub(kop)} оформлен. Статус обновится в истории.`;
    if(!result.error) {input.value='';await loadWallet();loadOperationHistory(true);}
  } finally {refundBusy=false;renderRefund();}
}
async function acceptLegalEdition() {
  const terms=document.getElementById('legal-accept-terms'), pd=document.getElementById('legal-accept-pd');
  [terms,pd].forEach(el=>el.toggleAttribute('aria-invalid',!el.checked));
  if(!terms.checked||!pd.checked) {toast('Отметь оба согласия');return;}
  const result=await apiCallStrict('POST','/account/legal',{acceptTerms:true,acceptPersonalData:true});
  if(result.error) {toast(result.error);return;}
  if(wallet) wallet.legal=result;
  renderWallet(); toast('Редакция принята');
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
  $('refund-go').onclick=doRefund;
  $('refund-amount').addEventListener('input',()=>{$('refund-amount').removeAttribute('aria-invalid');delete $('refund-status').dataset.result;renderRefund();});
  $('legal-accept-go').onclick=acceptLegalEdition;
  // Back from the payment page (browser tab or the app resumed): ask the server.
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&liveMoney()&&wallet?.pending&&!walletLoading) loadWallet(); });
  // «Назад» со страницы оплаты возвращает страницу из кэша браузера со старым состоянием.
  window.addEventListener('pageshow',event=>{ if(event.persisted&&liveMoney()&&!walletLoading) loadWallet(); });
  $('operations-more').onclick=()=>loadOperationHistory();
  $('operations-list').addEventListener('click',event=>{
    const button=event.target.closest('[data-operation]');
    if(button&&$('operations-list').contains(button)) openOperation(operationHistory[Number(button.dataset.operation)]);
  });
  [['.history-link','operations'],['.history-back','profile']].forEach(([selector,screen])=>{
    $(screen==='operations'?'screen-profile':'screen-operations').querySelector(selector).addEventListener('click',event=>{
      if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey) return;
      event.preventDefault(); switchScreen(screen);
    });
  });
  $('operation-close').onclick=()=>closeSheet('operation-overlay');
  $('topup-custom').addEventListener('input',()=>{$('topup-custom').removeAttribute('aria-invalid');$('topup-error').hidden=true;updateTopupFee();});
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
