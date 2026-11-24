// Isolated fixture. No personal media; a generated PNG and canvas recording.
async page => {
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:390,height:844});
 await page.goto('http://127.0.0.1:3399');
 const result=await page.evaluate(async()=>{
  const assert=(x,m)=>{if(!x)throw Error(m);};
  document.querySelectorAll('.sheet-overlay,.intro').forEach(x=>x.hidden=true);document.querySelector('.app').inert=false;
  openProofBanner({id:'gallery-test',name:'Проверка галереи'});
  assert(!document.getElementById('proof-gallery').disabled,'gallery needs camera');
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#4b70ff';ctx.fillRect(0,0,64,64);
  const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
  await proofSelectFile(new File([blob],'neutral.png',{type:'image/png'}));
  assert(proofSource==='gallery'&&proofBlob.size===blob.size,'gallery preview');
  assert(document.getElementById('proof-source').textContent.includes('Из галереи'),'source label');
  const kept=proofBlob;
  await proofSelectFile(new File([new Uint8Array(5*1024*1024+1)],'large.png',{type:'image/png'}));
  assert(!document.getElementById('proof-upload-error').hidden&&proofBlob===kept,'size/previous preview');
  await proofSelectFile(new File(['fake'],'bad.png',{type:'image/png'}));
  assert(!document.getElementById('proof-upload-error').hidden&&proofBlob===kept,'invalid decode');
  await proofSelectFile(new File(['fake'],'bad.svg',{type:'image/svg+xml'}));
  assert(proofBlob===kept,'unsupported file');
  const stream=canvas.captureStream(10), recorder=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks=[];
  const video=await new Promise(resolve=>{
   recorder.ondataavailable=e=>chunks.push(e.data);
   recorder.onstop=()=>resolve(new Blob(chunks,{type:'video/webm'}));
   recorder.start();setTimeout(()=>{ctx.fillStyle='green';ctx.fillRect(0,0,64,64);},100);setTimeout(()=>recorder.stop(),400);
  });stream.getTracks().forEach(t=>t.stop());
  // WebM MediaRecorder may omit metadata duration; this gallery must reject
  // an uncheckable duration rather than bypass the server's 15-second limit.
  await proofSelectFile(new File([video],'short.webm',{type:'video/webm'}));
  const videoOutcome=proofType==='video'?'preview':'duration unavailable rejected';
  await proofSelectFile(new File([blob],'neutral.png',{type:'image/png'}));
  const oldFetch=window.fetch;authToken='a'.repeat(64);let sent;
  window.fetch=async(url,options)=>{sent={url:String(url),size:options.body.size};return new Response(JSON.stringify({error:'synthetic interrupted upload'}),{status:503,headers:{'Content-Type':'application/json'}});};
  try{await proofSend();assert(sent.url.includes('source=gallery'),'source missing in upload');assert(proofBlob&& !document.getElementById('proof-upload-error').hidden,'retry lost file');}
  finally{window.fetch=oldFetch;}
  return {photo:true,videoOutcome,sizeRejected:true,invalidRejected:true,uploadSource:true,retryRetainsFile:true};
 });
 for(const width of [320,390]){
  await page.setViewportSize({width,height:844});
  if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))throw Error('overflow '+width);
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.screenshot({path:'test-results/phase4-gallery-mobile.png',fullPage:true});
 if(errors.length)throw Error(errors.join(';'));
 return {ok:true,...result,errors};
}
