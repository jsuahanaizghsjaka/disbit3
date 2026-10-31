// Run with playwright-cli in isolated desktop and mobile browser sessions.
async page => {
  const assert=(value,message)=>{if(!value) throw Error(message);};
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:3471/');
  const pointer=await page.evaluate(async()=>{
    document.documentElement.dataset.input='pointer';
    document.activeElement?.blur();openSheet('add-overlay');await Promise.resolve();
    return {coarse:matchMedia('(pointer: coarse)').matches,id:document.activeElement.id,tag:document.activeElement.tagName};
  });
  if(pointer.coarse) assert(pointer.id==='add-title','Touch opening focused an input instead of the heading');
  else assert(pointer.tag==='INPUT','Desktop pointer did not focus the first input');
  const keyboard=await page.evaluate(async()=>{
    closeSheet('add-overlay');await Promise.resolve();
    document.documentElement.dataset.input='keyboard';document.activeElement?.blur();openSheet('add-overlay');await Promise.resolve();
    return {tag:document.activeElement.tagName,id:document.activeElement.id};
  });
  assert(keyboard.tag==='INPUT','Keyboard opening did not focus input');
  await page.evaluate(()=>closeSheet('add-overlay'));
  assert(errors.length===0,`Page errors: ${errors.join('; ')}`);
  return {pointer,keyboard,errors:errors.length};
}
