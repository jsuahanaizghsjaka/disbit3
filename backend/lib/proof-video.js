import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
let active = 0;
export function checkedDuration(info) {
  if (!info.streams?.some(s => s.codec_type === 'video')) throw Error('invalid-video');
  const values = [Number(info.format?.duration)];
  let first = Infinity, last = -Infinity;
  for (const packet of info.packets || []) {
    const start = Number(packet.pts_time), duration = Number(packet.duration_time || 0);
    if (Number.isFinite(start) && Number.isFinite(duration) && duration >= 0) {
      first = Math.min(first, start); last = Math.max(last, start + duration);
    }
  }
  if (Number.isFinite(first) && Number.isFinite(last)) values.push(last - first);
  const duration = Math.max(...values.filter(Number.isFinite));
  if (!(duration > 0)) throw Error('invalid-video');
  if (duration > 15.1) throw Error('video-too-long'); // one encoded frame of tolerance
  return duration;
}

export async function validateVideo(bytes) {
  if (active >= 2) throw Error('video-busy');
  active++;
  let directory;
  try {
    directory = await mkdtemp(path.join(tmpdir(),'disbit-proof-'));
    const file = path.join(directory,'upload');
    await writeFile(file,bytes,{mode:0o600});
    const {stdout} = await run(process.env.FFPROBE_PATH || 'ffprobe',[
      '-v','error','-protocol_whitelist','file','-show_entries',
      'format=duration:stream=codec_type:packet=pts_time,duration_time','-of','json',file
    ],{timeout:8000,maxBuffer:1024*1024,windowsHide:true});
    return checkedDuration(JSON.parse(stdout));
  } finally {
    try { if (directory) await rm(directory,{recursive:true,force:true}); }
    finally { active--; }
  }
}
