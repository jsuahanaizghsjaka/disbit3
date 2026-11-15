// Synthetic localhost only. Permission grants and streams are simulated.
async page => {
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3399/?diagnostics=1');
 const result=await page.evaluate(async()=>{
  const assert=(x,m)=>{if(!x)throw Error(m);};
  const oldMedia=navigator.mediaDevices.getUserMedia;
  const oldApi=apiCallStrict,oldConfirm=window.confirm;
  const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;
  const streams=[];
  try {
   proofHabit={id:'synthetic',name:'Camera'};
   navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError');};
   await startProofCam();
   assert(!document.getElementById('proof-cam-err').hidden,'denial hidden');
   assert(!document.getElementById('proof-start').hidden,'retry missing');
   assert(document.getElementById('proof-photo').disabled,'capture enabled without camera');
   navigator.mediaDevices.getUserMedia=async()=>{const stream=canvas.captureStream(1);streams.push(stream);return stream;};
   for(let i=0;i<3;i++){
    await startProofCam();assert(proofStream?.getVideoTracks()[0].readyState==='live','retry failed');
    stopProofCam();assert(streams[i].getTracks().every(t=>t.readyState==='ended'),'track leaked');
   }
   proofHabit=null;
   authToken='a'.repeat(64);stateRemoteVersion='100';stateSyncConflict=false;
   profile.name='Local unsynced';
   apiCallStrict=async()=>({error:'conflict',status:409});
   scheduleStatePush();await new Promise(r=>setTimeout(r,1100));
   assert(stateSyncConflict,'conflict not surfaced');
   assert(profile.name==='Local unsynced','local state overwritten');
   window.confirm=()=>false;
   await document.querySelector('#connection-state button').onclick();
   assert(stateSyncConflict&&profile.name==='Local unsynced','cancel lost local copy');
   const snapshot=DisbitPerf.snapshot();
   assert(snapshot.enabled&&snapshot.samples.length>0,'diagnostics empty');
   assert(!JSON.stringify(snapshot).includes(authToken),'diagnostics token leak');
   return {denialRetry:true,threeCameraCycles:true,conflictPreservesLocal:true,cancelPreservesLocal:true,diagnostics:true};
  } finally {
   navigator.mediaDevices.getUserMedia=oldMedia;apiCallStrict=oldApi;window.confirm=oldConfirm;
   streams.forEach(s=>s.getTracks().forEach(t=>t.stop()));clearTimeout(statePushTimer);
  }
 });
 if(errors.length)throw Error(errors.join('; '));
 return {ok:true,...result,errors};
}
