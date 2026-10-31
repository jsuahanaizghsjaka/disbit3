// Uses synthetic canvas streams and an isolated fixture; never captures real media.
async page => {
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:3399/');
  const result=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas'); canvas.width=16; canvas.height=16;
    const original=canvas.captureStream(1), derived=canvas.captureStream(1);
    const originalTrack=original.getVideoTracks()[0], derivedTrack=derived.getVideoTracks()[0];
    const next=canvas.captureStream(1), nextTrack=next.getVideoTracks()[0];
    const priorGetUserMedia=navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia=async()=>next;
    try {
      proofHabit={id:'synthetic',name:'Test'};
      proofStream=original; proofRecordStream=derived;
      document.getElementById('proof-cam').srcObject=original;
      proofBlob=new Blob(['synthetic'],{type:'image/jpeg'});
      proofShowPreview(URL.createObjectURL(proofBlob),'photo');
      const stopped=originalTrack.readyState==='ended' && derivedTrack.readyState==='ended';
      const previewPreserved=proofBlob.size>0 && !document.getElementById('proof-preview').hidden;
      const cameraDetached=document.getElementById('proof-cam').srcObject===null;
      proofRetake();
      await new Promise(resolve=>setTimeout(resolve,50));
      const retake=proofStream===next && nextTrack.readyState==='live';
      document.getElementById('proof-flip').disabled=true;
      document.getElementById('proof-video').textContent='■ Стоп';
      suspendProofCamera();
      const retakeStopped=nextTrack.readyState==='ended' && !document.getElementById('proof-start').hidden;
      const controlsReset=!document.getElementById('proof-flip').disabled && document.getElementById('proof-video').textContent==='● Видео';
      proofBlob=new Blob(['saved'],{type:'image/jpeg'});
      suspendProofCamera();
      const savedBlobSurvives=proofBlob.size===5;
      proofHabit=null;
      return {stopped,previewPreserved,cameraDetached,retake,retakeStopped,controlsReset,savedBlobSurvives};
    } finally { navigator.mediaDevices.getUserMedia=priorGetUserMedia; original.getTracks().forEach(t=>t.stop()); derived.getTracks().forEach(t=>t.stop()); next.getTracks().forEach(t=>t.stop()); }
  });
  if(Object.values(result).some(v=>!v)||errors.length) throw Error(JSON.stringify({result,errors}));
  return {ok:true,...result};
}
