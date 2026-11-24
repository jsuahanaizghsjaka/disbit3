import {createHash} from 'node:crypto';
import {db} from '../db/db.js';

db.exec('CREATE TABLE IF NOT EXISTS request_limits (bucket TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)');
let cleanedAt = 0;
// Persistent counters survive process restarts; only hashed identifiers are stored.
export function requestLimit(scope, maximum, interval, identify = req => req.ip) {
  return (req, res, next) => {
    const now = Date.now();
    if (now - cleanedAt > 60000) {
      db.prepare('DELETE FROM request_limits WHERE window_start < ?').run(now - 86400000);
      cleanedAt = now;
    }
    const bucket = scope + ':' + createHash('sha256').update(String(identify(req))).digest('hex');
    // One statement makes admission atomic, even if another process uses this DB.
    const row = db.prepare(`INSERT INTO request_limits(bucket,window_start,count) VALUES(?,?,1)
      ON CONFLICT(bucket) DO UPDATE SET
        window_start=CASE WHEN window_start<=? THEN excluded.window_start ELSE window_start END,
        count=CASE WHEN window_start<=? THEN 1 ELSE count+1 END
      RETURNING window_start,count`).get(bucket, now, now-interval, now-interval);
    if (row.count <= maximum) return next();
    res.set('Retry-After', String(Math.max(1, Math.ceil((row.window_start + interval - now)/1000))));
    res.set('Cache-Control', 'no-store');
    return res.status(429).json({error:'Слишком много запросов. Подождите и повторите.'});
  };
}
