// Isolated fixture and in-memory stub; no real friend accounts are changed.
async page => {
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3399/');
  const result=await page.evaluate(async()=>{
    const original=apiCallStrict, oldRender=renderFriends, oldBoard=renderFriendsBoard;
    let calls=0;
    renderFriends=()=>{}; renderFriendsBoard=()=>{};
    apiCallStrict=async()=>({me:authUser.login,friends:[{login:'friend-'+(++calls)}]});
    try {
      setAuth('synthetic-a',{login:'a'});
      await loadFriends(); await loadFriends();
      const cached=calls===1;
      await loadFriends(true);
      const forced=calls===2 && serverFriends[0].login==='friend-2';
      setAuth('synthetic-b',{login:'b'});
      const isolated=serverFriends.length===0 && myLogin===null;
      await loadFriends();
      const newOwner=calls===3 && myLogin==='b';
      let finishAdd;
      apiCallStrict=()=>new Promise(resolve=>{finishAdd=resolve});
      const pendingAdd=addFriendByLogin('another-friend',true);
      setAuth('synthetic-c',{login:'c'});
      finishAdd({ok:true});
      await pendingAdd;
      const staleMutationIgnored=serverFriends.length===0 && myLogin===null;
      return {cached,forced,isolated,newOwner,staleMutationIgnored};
    } finally {apiCallStrict=original;renderFriends=oldRender;renderFriendsBoard=oldBoard;}
  });
  if(Object.values(result).some(v=>!v)||errors.length) throw Error(JSON.stringify({result,errors}));
  return {ok:true,...result};
}
