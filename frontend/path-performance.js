/* Opt-in, in-memory diagnostics. No network, account identifiers or field values. */
(() => {
  const enabled=new URLSearchParams(location.search).get('diagnostics')==='1';
  const rows=[],counts={},observers=[];
  const supported=globalThis.PerformanceObserver?.supportedEntryTypes||[];
  const allowed=new Set(['startup','navigation','render','state-save','camera-ready','server-ready']);
  const record=(action,duration)=>{if(enabled){rows.push({action,duration});if(rows.length>500)rows.shift();}};
  if(enabled)for(const type of ['longtask','event']){
    if(!supported.includes(type))continue;
    const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())record(type,entry.duration);});
    observer.observe(type==='event'?{type,buffered:true,durationThreshold:16}:{type,buffered:true});observers.push(observer);
  }
  window.DisbitPerf={
    start(action){if(!enabled||!allowed.has(action))return null;performance.mark('disbit:'+action+':start');return performance.now();},
    end(action,start){if(start===null||!enabled||!allowed.has(action))return;record(action,performance.now()-start);performance.mark('disbit:'+action+':end');performance.measure('disbit:'+action,'disbit:'+action+':start','disbit:'+action+':end');performance.clearMarks('disbit:'+action+':start');performance.clearMarks('disbit:'+action+':end');performance.clearMeasures('disbit:'+action);},
    frame(action,start){if(start!==null)requestAnimationFrame(()=>requestAnimationFrame(()=>record(action+':two-raf',performance.now()-start)));},
    count(action){if(enabled&&allowed.has(action))counts[action]=(counts[action]||0)+1;},
    snapshot(){return {enabled,platform:navigator.platform,longTasks:supported.includes('longtask')?'available':'unavailable',eventTiming:supported.includes('event')?'available':'unavailable',counts:{...counts},samples:rows.slice(),note:'Two rAF is a scheduling proxy, not proof of presentation or INP. No field Web Vitals collected.'};},
    stop(){observers.forEach(o=>o.disconnect());}
  };
})();
