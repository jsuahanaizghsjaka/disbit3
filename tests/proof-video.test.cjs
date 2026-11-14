const {test}=require('node:test');
const assert=require('node:assert/strict');
test('video duration uses packets when browser WebM has no duration; rejects long or missing video',async()=>{
 const {checkedDuration}=await import('../backend/lib/proof-video.js');
 const streams=[{codec_type:'video'}];
 assert.equal(checkedDuration({streams,format:{duration:'12'}}),12);
 assert.equal(checkedDuration({streams,packets:[{pts_time:'0',duration_time:'0.04'},{pts_time:'14.96',duration_time:'0.04'}]}),15);
 assert.throws(()=>checkedDuration({streams,format:{duration:'16'}}),/video-too-long/);
 assert.throws(()=>checkedDuration({streams,format:{duration:'1'},packets:[{pts_time:'0'},{pts_time:'16'}]}),/video-too-long/);
 assert.throws(()=>checkedDuration({streams:[],format:{duration:'1'}}),/invalid-video/);
 assert.throws(()=>checkedDuration({streams,format:{duration:'N/A'}}),/invalid-video/);
});
