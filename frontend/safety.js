const origin = location.hostname==='localhost' && !location.port ? 'https://disbit.ru' : '';
const result=document.getElementById('result');
async function call(method,route,body) {
 const token=localStorage.getItem('disbit_token_v1');
 if(!token) throw Error('Сначала войдите в Disbit.');
 const r=await fetch(origin+'/api/moderation'+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const data=await r.json();if(!r.ok)throw Error(data.error || 'Не удалось выполнить действие');return data;
}
async function loadBlocks(){
 const {items}=await call('GET','/blocks');const list=document.getElementById('blocks');list.replaceChildren();
 for(const user of items){const li=document.createElement('li'),b=document.createElement('button');li.append('@'+user.login);b.textContent='Разблокировать '+user.login;b.onclick=async()=>{b.disabled=true;try{await call('DELETE','/blocks/'+encodeURIComponent(user.login));await loadBlocks();}catch(e){result.textContent=e.message;b.disabled=false;}};li.append(b);list.append(li);}
 if(!items.length)list.textContent='Заблокированных пользователей нет.';
}
document.getElementById('safety-form').onsubmit=async event=>{
 event.preventDefault();const type=event.submitter.value;const buttons=[...event.currentTarget.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
 try{const login=document.getElementById('target').value.trim(),reason=document.getElementById('reason').value.trim();const data=await call('POST',type==='block'?'/blocks':'/reports',{login,reason});result.textContent=type==='block'?'Пользователь заблокирован.':`Жалоба №${data.id} получена. Ответ — в течение 48 часов.`;await loadBlocks();}
 catch(e){result.textContent=e.message;}finally{buttons.forEach(b=>b.disabled=false);}
};
loadBlocks().catch(e=>result.textContent=e.message);
async function loadModeration(){
 const [notices,state]=await Promise.all([call('GET','/notices'),call('GET','/restriction')]);
 const box=document.getElementById('notices');box.replaceChildren();
 for(const item of notices.items){const p=document.createElement('p');p.textContent=item.message;box.append(p);}
 if(!notices.items.length)box.textContent='Пока нет ответов.';
 document.getElementById('appeal-section').hidden=!state.restriction;
 document.getElementById('restriction').textContent=state.restriction?.reason||'';
 document.getElementById('appeal-form').hidden=state.appeal?.status==='pending';
 if(state.appeal?.status==='pending')document.getElementById('restriction').textContent+=' Обращение принято. Ответ — в течение 48 часов.';
}
document.getElementById('appeal-form').onsubmit=async event=>{
 event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;
 try{await call('POST','/appeals',{message:document.getElementById('appeal-message').value});await loadModeration();result.textContent='Обращение отправлено.';}
 catch(e){result.textContent=e.message;}finally{button.disabled=false;}
};
loadModeration().catch(e=>result.textContent=e.message);
