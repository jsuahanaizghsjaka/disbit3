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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// медиа рядом с базой (на Railway это persistent volume), локально — backend/db/proofs
const DATA_DIR = process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(__dirname, '..', 'db');
const PROOFS_DIR = process.env.PROOFS_DIR || path.join(DATA_DIR, 'proofs');
fs.mkdirSync(PROOFS_DIR, { recursive: true });

const ADMIN_KEY = process.env.ADMIN_KEY || 'disbit-admin';   // задать на Railway!
const MAX_BYTES = 25 * 1024 * 1024;                          // 25 МБ на пруф

const router = Router();
const uid = req => req.userId || 0;

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
              'video/webm': 'webm', 'video/mp4': 'mp4' };

/* -------- загрузка пруфа (сырые байты) --------
   POST /api/proofs?habitId=..&day=YYYY-MM-DD&type=photo|video&name=..
   тело = байты медиа, Content-Type = image/* | video/* */
router.post('/', express.raw({ type: () => true, limit: MAX_BYTES }), (req, res) => {
  const { habitId, day, name } = req.query;
  const type = req.query.type === 'video' ? 'video' : 'photo';
  const mime = req.headers['content-type'] || '';

  if (!habitId || !/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) {
    return res.status(400).json({ error: 'Нужны habitId и корректный day' });
  }
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).json({ error: 'Пустое медиа' });
  }
  const ext = EXT[mime] || (type === 'video' ? 'webm' : 'jpg');
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
  const info = db.prepare(`
    INSERT INTO proofs (user_id, user_login, habit_id, habit_name, day, type, file, mime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uid(req), login, String(habitId), String(name || ''), String(day), type, fname, mime);

  res.status(201).json({ ok: true, id: info.lastInsertRowid, status: 'pending' });
});

/* -------- АДМИН: доступ по ключу -------- */
function adminOnly(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'Нужен админ-ключ' });
  next();
}

// GET /api/proofs?status=pending — список (без файлов)
router.get('/', adminOnly, (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const rows = db.prepare(`
    SELECT id, user_login, habit_name, day, type, mime, status, created_at
    FROM proofs WHERE status = ? ORDER BY id DESC LIMIT 200
  `).all(status);
  const counts = db.prepare(`SELECT status, COUNT(*) n FROM proofs GROUP BY status`).all();
  res.json({ items: rows, counts: Object.fromEntries(counts.map(c => [c.status, c.n])) });
});

// GET /api/proofs/:id/media — сам файл (только админ)
router.get('/:id/media', adminOnly, (req, res) => {
  const row = db.prepare('SELECT file, mime FROM proofs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).end();
  const fp = path.join(PROOFS_DIR, row.file);
  if (!fs.existsSync(fp)) return res.status(404).end();
  if (row.mime) res.type(row.mime);
  res.sendFile(fp);
});

// POST /api/proofs/:id/decision { status: 'approved' | 'rejected' }
router.post('/:id/decision', express.json(), adminOnly, (req, res) => {
  const status = req.body?.status;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status должен быть approved или rejected' });
  }
  const info = db.prepare('UPDATE proofs SET status = ? WHERE id = ?').run(status, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Пруф не найден' });
  res.json({ ok: true, id: Number(req.params.id), status });
});

export default router;
