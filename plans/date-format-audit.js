async page => page.evaluate(()=>{
  const keys=Array.from({length:259},(_,i)=>dateKey(addDays(new Date(),-i)));
  const formatter=new Intl.DateTimeFormat('ru-RU',{weekday:'short',day:'numeric',month:'long'});
  const equal=keys.every(key=>formatDay(key)===formatter.format(keyToDate(key)));
  const samples=[];
  for(let run=0;run<3;run++){
    let t=performance.now();keys.map(formatDay);const currentMs=performance.now()-t;
    t=performance.now();keys.map(key=>formatter.format(keyToDate(key)));const reusedFormatterMs=performance.now()-t;
    samples.push({currentMs,reusedFormatterMs});
  }
  return {callsPerSample:keys.length,equal,samples,note:'Microbenchmark only; not an end-to-end speedup prediction.'};
})
