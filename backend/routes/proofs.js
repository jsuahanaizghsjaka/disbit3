/* ============================================================
   Пруфы выполнения обещания — живое фото/видео.
   • Пользователь снимает пруф в приложении (камера) и шлёт СЫРЫМИ байтами
     (Content-Type = image/* или video/*), метаданные — в query.
   • Файл кладём в PROOFS_DIR (volume рядом с базой), в БД — только метаданные.
   • Проверяет пруфы только АДМИН (заголовок X-Admin-Key === ADMIN_KEY):
     список ожидающих, просмотр медиа, решение approved/rejected.
   Это чувствительные данные (лица людей) — медиа отдаём только админу.
   ============================================================ */

import { Router } from 'express';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db } from '../db/db.js';
import { accountDay, proofSatisfied, proofQuota } from '../proof-policy.js';
import { transaction, syncTrustedBitAward, trustedCompletionEligible } from '../lib/promise-skips.js';
import { validateVideo } from '../lib/proof-video.js';
import {requestLimit} from '../lib/request-limits.js';
import {pruneProofMedia} from '../lib/proof-retention.js';
import { notifyProofDecision } from '../lib/telegram-bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// медиа рядом с базой (на Railway это persistent volume), локально — backend/db/proofs
const DATA_DIR = process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(__dirname, '..', 'db');
const PROOFS_DIR = process.env.PROOFS_DIR || path.join(DATA_DIR, 'proofs');
fs.mkdirSync(PROOFS_DIR, { recursive: true });
if(process.platform!=='win32'){
  fs.chmodSync(PROOFS_DIR,0o700);
  for(const entry of fs.readdirSync(PROOFS_DIR,{withFileTypes:true}))if(entry.isFile())fs.chmodSync(path.join(PROOFS_DIR,entry.name),0o600);
}

/* Ключ админа — ТОЛЬКО из окружения, без запасного значения. Раньше здесь стоял
   `|| 'disbit-admin'`, и на сервере, где переменную забыли задать, чужие фото и
   видео открывались по ключу, лежащему в открытом исходнике. Нет ключа — панель
   просто выключена: это заметно сразу, в отличие от тихо открытой двери. */
const ADMIN_KEY = process.env.ADMIN_KEY || '';
db.prepare("UPDATE proofs SET resolved_at=datetime('now') WHERE status IN ('approved','rejected') AND resolved_at IS NULL").run();
const sweep=()=>{try{pruneProofMedia(db,PROOFS_DIR);}catch{console.error('[proofs] retention cleanup failed');}};
sweep();setInterval(sweep,3600000).unref();
if (!ADMIN_KEY) {
  console.warn('[proofs] ADMIN_KEY не задан — панель проверки пруфов выключена');
} else if (ADMIN_KEY.length < 32) {
  console.warn('[proofs] ADMIN_KEY короче 32 символов — панель выключена');
}
const MAX_BYTES = 10 * 1024 * 1024;

const router = Router();
db.exec(`CREATE TABLE IF NOT EXISTS proof_decisions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, proof_id INTEGER NOT NULL REFERENCES proofs(id) ON DELETE CASCADE,
 status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));`);
const uid = req => req.userId;   // загрузка под authRequired — гостя здесь не бывает

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
              'video/webm': 'webm', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };
// обратная таблица: тип файла при отдаче берём ТОЛЬКО отсюда, по расширению
const MIME_BY_EXT = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
                      webm: 'video/webm', mp4: 'video/mp4', mov: 'video/quicktime' };

// Загрузка — только для авторизованных. Без этого любой человек из интернета
// мог класть на диск по 25 МБ сколько угодно раз: том кончится, приложение встанет.
function authRequired(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Нужен аккаунт' });
  next();
}

router.get('/quota', authRequired, (req, res) => {
  const day = accountDay(req);
  res.json({ ...proofQuota(uid(req), day), satisfied: proofSatisfied(uid(req), String(req.query.habitId || ''), day) });
});

router.post('/skip', authRequired, (req, res) => {
  const { habitId, day } = req.body || {};
  if (day !== accountDay(req)) return res.status(403).json({ error: 'Пропустить пруф можно только за сегодня' });
  const habit = db.prepare('SELECT id,archived FROM habits WHERE id=? AND user_id=?').get(String(habitId || ''), uid(req));
  if (!habit) return res.status(404).json({ error: 'Обещание не найдено' });
  if (habit.archived) return res.status(409).json({ error: 'Обещание в архиве' });
  // Synchronous transaction protects the last slot across concurrent requests/processes.
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!proofSatisfied(uid(req), habit.id, day)) {
      if (!proofQuota(uid(req), day).remaining) {
        db.exec('ROLLBACK');
        return res.status(409).json({ error: 'Пять пропусков за месяц использованы. Отправь фото или видео.' });
      }
      db.prepare('INSERT INTO proof_skips (user_id,habit_id,day,month) VALUES (?,?,?,?)').run(uid(req), habit.id, day, day.slice(0,7));
    }
    syncTrustedBitAward(db,uid(req),habit.id,day,trustedCompletionEligible(db,uid(req),habit.id,day));
    db.exec('COMMIT');
    res.json({ ok:true, ...proofQuota(uid(req), day) });
  } catch (error) { db.exec('ROLLBACK'); throw error; }
});

/* -------- загрузка пруфа (сырые байты) --------
   POST /api/proofs?habitId=..&day=YYYY-MM-DD&type=photo|video&name=..
   тело = байты медиа, Content-Type = image/* | video/* */
router.post('/', authRequired,
  requestLimit('proof-user', 30, 60*60000, req => req.userId),
  requestLimit('proof-ip', 120, 60000),
  express.raw({ type: () => true, limit: MAX_BYTES }), async (req, res, next) => {
  const { habitId, day, name } = req.query;
  const type = req.query.type === 'video' ? 'video' : 'photo';
  const source = req.query.source == null ? 'unknown' : String(req.query.source);
  if (!['camera','gallery','unknown'].includes(source)) return res.status(400).json({error:'Неизвестный источник файла'});
  const mime = req.headers['content-type'] || '';

  if (!habitId || !/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) {
    return res.status(400).json({ error: 'Нужны habitId и корректный day' });
  }
  if (day !== accountDay(req)) return res.status(403).json({ error: 'Пруф можно отправить только за сегодня' });
  const habit = db.prepare('SELECT id,name,archived FROM habits WHERE id=? AND user_id=?').get(String(habitId), uid(req));
  if (!habit) return res.status(404).json({ error: 'Обещание не найдено' });
  if (habit.archived) return res.status(409).json({ error: 'Обещание в архиве' });
  const mediaType = mime.split(';')[0].trim();
  if(db.prepare('SELECT count(*) n FROM proofs WHERE user_id=? AND habit_id=? AND day=?').get(uid(req),habit.id,day).n>=3)return res.status(429).json({error:'Не больше трёх пруфов для одного обещания за день'});
  if (!EXT[mediaType] || (type === 'video') !== mediaType.startsWith('video/')) {
    return res.status(415).json({ error: 'Нужно фото JPEG/PNG/WebP или видео MP4/MOV/WebM' });
  }
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).json({ error: 'Пустое медиа' });
  }
  const bytes = req.body;
  if (type === 'photo' && bytes.length > 5 * 1024 * 1024) {
    return res.status(413).json({ error: 'Фото должно быть не больше 5 МБ' });
  }
  const signature = mediaType === 'image/jpeg' ? bytes.subarray(0,3).equals(Buffer.from([255,216,255])) :
    mediaType === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
    mediaType === 'image/webp' ? bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP' :
    mediaType === 'video/webm' ? bytes.subarray(0,4).equals(Buffer.from([26,69,223,163])) :
    bytes.toString('ascii',4,8)==='ftyp';
  if (!signature) return res.status(415).json({ error: 'Файл не похож на фото или видео. Пересними пруф.' });
  if (type === 'video') {
    try { await validateVideo(bytes); }
    catch (error) {
      if (error.code === 'ENOENT') return res.status(503).json({error:'Проверка видео временно недоступна. Отправь фото.'});
      if (error.message === 'video-busy') return res.status(429).json({error:'Сейчас проверяются другие видео. Повтори через несколько секунд.'});
      return res.status(400).json({error:error.message === 'video-too-long' ? 'Видео должно быть не длиннее 15 секунд' : 'Не удалось проверить видео. Пересними пруф или отправь фото.'});
    }
    // Async validation may overlap account deletion or archiving.
    if (!db.prepare('SELECT 1 FROM habits WHERE id=? AND user_id=? AND archived=0').get(String(habitId),uid(req))) return res.status(409).json({error:'Обещание больше недоступно'});
  }
  const ext = EXT[mediaType];
  // Recheck after asynchronous video validation; synchronous write follows.
  if(db.prepare('SELECT count(*) n FROM proofs WHERE user_id=? AND habit_id=? AND day=?').get(uid(req),habit.id,day).n>=3)return res.status(429).json({error:'Не больше трёх пруфов для одного обещания за день'});
  const fname = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
  try {
    fs.writeFileSync(path.join(PROOFS_DIR, fname), req.body);
  } catch (e) {
    return res.status(500).json({ error: 'Не удалось сохранить файл' });
  }

  let login = null;
  if (req.userId) {
    const u = db.prepare('SELECT login FROM users WHERE id = ?').get(req.userId);
    login = u?.login || null;
  }
  let info;
  try { info = db.prepare(`
    INSERT INTO proofs (user_id, user_login, habit_id, habit_name, day, type, file, mime, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uid(req), login, String(habitId), habit.name, String(day), type, fname, mime, source);
  } catch (error) { fs.rmSync(path.join(PROOFS_DIR,fname),{force:true}); return next(error); }

  res.status(201).json({ ok: true, id: info.lastInsertRowid, status: 'pending' });
});

/* -------- АДМИН: доступ по ключу --------
   Сравниваем через timingSafeEqual по хэшам: обычное `!==` выходит из сравнения
   на первом несовпавшем символе, и по времени ответа ключ подбирается посимвольно.
   Хэш нужен, чтобы буферы всегда были одной длины (иначе timingSafeEqual бросает). */
function keyMatches(given) {
  if (!ADMIN_KEY || !given) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(ADMIN_KEY).digest();
  return crypto.timingSafeEqual(a, b);
}

export function adminOnly(req, res, next) {
  if (ADMIN_KEY.length < 32) {
    return res.status(503).json({ error: 'Панель выключена: требуется настройка ключа администратора' });
  }
  res.set('Cache-Control', 'no-store');
  const key = req.headers['x-admin-key'];
  if (!keyMatches(key)) return requestLimit('admin-key',30,15*60000)(req,res,()=>res.status(401).json({ error: 'Нужен админ-ключ' }));
  next();
}

// GET /api/proofs?status=pending — список (без файлов)
router.get('/', adminOnly, (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const rows = db.prepare(`
    SELECT id, user_login, habit_name, day, type, mime, source, status, created_at, media_deleted
    FROM proofs WHERE status = ? ORDER BY id DESC LIMIT 200
  `).all(status);
  const counts = db.prepare(`SELECT status, COUNT(*) n FROM proofs GROUP BY status`).all();
  res.json({ items: rows, counts: Object.fromEntries(counts.map(c => [c.status, c.n])) });
});

// GET /api/proofs/:id/media — сам файл (только админ)
router.get('/:id/media', adminOnly, (req, res) => {
  const row = db.prepare('SELECT file, mime, media_deleted FROM proofs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).end();
  if(row.media_deleted)return res.status(410).json({error:'Медиа удалено по сроку хранения'});
  const fp = path.join(PROOFS_DIR, row.file);
  if (!fs.existsSync(fp)) return res.status(404).end();
  // Тип отдаём по РАСШИРЕНИЮ из белого списка, а не из mime в базе: тот пришёл
  // заголовком от загрузившего, и text/html превратил бы «пруф» в страницу,
  // выполняющуюся в нашем origin, если открыть ссылку на медиа напрямую.
  const ext = path.extname(row.file).slice(1).toLowerCase();
  res.type(MIME_BY_EXT[ext] || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(fp);
});

// POST /api/proofs/:id/decision { status: 'approved' | 'rejected' }
router.post('/:id/decision', express.json(), adminOnly, (req, res) => {
  const status = req.body?.status;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status должен быть approved или rejected' });
  }
  const updated = transaction(db, () => {
    const proof = db.prepare('SELECT user_id,habit_id,day,status FROM proofs WHERE id=?').get(req.params.id);
    if (!proof) return false;
    if(proof.status!=='pending')return 'resolved';
    db.prepare("UPDATE proofs SET status=?,resolved_at=datetime('now') WHERE id=?").run(status,req.params.id);
    db.prepare('INSERT INTO proof_decisions(proof_id,status) VALUES(?,?)').run(req.params.id,status);
    syncTrustedBitAward(db,proof.user_id,proof.habit_id,proof.day,
      trustedCompletionEligible(db,proof.user_id,proof.habit_id,proof.day));
    return true;
  });
  if (!updated) return res.status(404).json({ error: 'Пруф не найден' });
  if(updated==='resolved')return res.status(409).json({error:'Решение уже принято'});
  try { notifyProofDecision(Number(req.params.id)); } catch { console.error('[telegram] proof notice failed'); }
  res.json({ ok: true, id: Number(req.params.id), status });
});

export default router;
