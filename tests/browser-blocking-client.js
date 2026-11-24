async page => {
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  for(const width of [390,1280]){
    await page.setViewportSize({width,height:844});
    await page.goto('http://localhost:3337/');
    const ok=await page.evaluate(async()=>{
      let applied=0,cleared=0;
      window.Capacitor={isNativePlatform:()=>true,getPlatform:()=>'android',isPluginAvailable:()=>true,Plugins:{AppBlocking:{
        getInstallation:async()=>({consentVersion:1,requiredConsentVersion:1,authorized:true}),
        getStatus:async()=>({authorized:true}),applyPlan:async()=>{applied++;return {enrolled:true}},
        clearPlan:async()=>{cleared++},listApps:async()=>({apps:[{package:'org.example.app',label:'Example'}]})
      }}};
      const apiFetch=window.fetch;
      window.fetch=(url,options)=>String(url).includes('/blocking/')?Promise.resolve(Response.json(
        String(url).endsWith('/plan')?{enrollment:'ok'}:{device:{id:'test'},enforcement:true}
      )):apiFetch(url,options);
      const client=window.DisbitBlocking;
      client.configure({api:()=>'/api',owner:()=>'tester',token:()=>'test'});
      await client.enroll(); client.syncLockForm(); await client.listApps();
      const choice=document.querySelector('#lock-app-list input');
      if(!choice)return false;
      choice.click();
      const selected=document.querySelector('#f-apps').value.includes('org.example.app');
      await client.disconnect();
      return selected&&applied===1&&cleared===1&&!client.ready();
    });
    if(!ok||errors.length)throw Error('Android bridge failed: '+errors.join(';'));
  }
}
