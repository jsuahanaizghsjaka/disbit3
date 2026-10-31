// Verify delivery messaging with a local fixture; no real email is sent.
async page => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3399/');
  const result=await page.evaluate(()=>{
    openVerifySheet('test@example.invalid',false);
    const failed=document.querySelector('#verify-instruction').textContent;
    closeSheet('verify-overlay');
    openVerifySheet('test@example.invalid',true);
    const sent=document.querySelector('#verify-instruction').textContent;
    closeSheet('verify-overlay');
    openVerifySheet('test@example.invalid');
    const unknown=document.querySelector('#verify-instruction').textContent;
    return {failed,sent,unknown};
  });
  if(!result.failed.includes('Не удалось') || !result.sent.includes('отправили') || result.unknown.includes('отправили') || errors.length)
    throw Error(JSON.stringify({result,errors}));
  return {ok:true,...result,errors};
}
