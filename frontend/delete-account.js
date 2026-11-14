const apiOrigin = location.hostname === 'localhost' && !location.port ? 'https://disbit.ru' : '';
document.getElementById('delete-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button=document.getElementById('delete-submit'), result=document.getElementById('result');
  button.disabled=true; result.textContent='Проверяем аккаунт…';
  const login=document.getElementById('login').value.trim();
  const password=document.getElementById('password').value;
  let temporaryToken;
  try {
    // Authenticate this destructive action explicitly; never reuse another account's cached session.
    const auth=await fetch(apiOrigin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:login,password})});
    const signed=await auth.json();
    if(!auth.ok) throw Error(signed.error || 'Не удалось войти');
    temporaryToken=signed.token;
    const response=await fetch(apiOrigin+'/api/account',{method:'DELETE',headers:{'Content-Type':'application/json',Authorization:'Bearer '+signed.token},body:JSON.stringify({password,confirmation:signed.user.login})});
    const data=await response.json();
    if(!response.ok) throw Error(data.error || 'Не удалось удалить аккаунт');
    const cached=JSON.parse(localStorage.getItem('disbit_auth_user_v1') || 'null');
    if(cached?.id===signed.user.id || localStorage.getItem('disbit_owner_v1')===signed.user.login) {
      for(const storage of [localStorage,sessionStorage]) for(const key of Object.keys(storage)) if(key.startsWith('disbit')) storage.removeItem(key);
    }
    document.getElementById('delete-form').hidden=true;
    result.textContent='Аккаунт удалён. Все сессии завершены.';
  } catch(error) { result.textContent=error.message || 'Ошибка соединения. Попробуйте ещё раз.'; }
  finally {
    // The reauthentication session must not survive a failed deletion.
    if(temporaryToken) await fetch(apiOrigin+'/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+temporaryToken}}).catch(()=>{});
    document.getElementById('password').value='';button.disabled=false;
  }
});
