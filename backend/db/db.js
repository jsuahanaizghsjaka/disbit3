/* ============================================================
   Подключение к SQLite через встроенный node:sqlite.
   Требуется Node.js ≥ 22.13 (или 23+). Никаких нативных
   зависимостей — база лежит в файле db/disbit.db.
   ============================================================ */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { runtime } from '../lib/runtime.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DB_PATH задаёт хостинг (persistent volume), локально — файл рядом.
// Каталог создаём заранее: если DB_PATH указывает на ещё не смонтированный том
// (например, /data до создания volume), DatabaseSync иначе упал бы на open.
const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'disbit.db');
if (runtime.hosted && process.env.INITIALIZE_DATABASE !== '1') {
  if (!existsSync(DB_FILE) || !existsSync(process.env.PROOFS_DIR)) {
    throw new Error('Hosted data is missing: verify mounted database and proofs; INITIALIZE_DATABASE=1 is for a new empty environment only');
  }
}
mkdirSync(path.dirname(DB_FILE), { recursive: true });
export const db = new DatabaseSync(DB_FILE);

// внешние ключи + схема
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec(readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// мягкие миграции для баз, созданных до появления авторизации
for (const sql of [
  "ALTER TABLE habits ADD COLUMN week_target INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE habits ADD COLUMN minimum_action TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE completions ADD COLUMN minimum INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE habits ADD COLUMN buddy TEXT DEFAULT ''",
  "ALTER TABLE habits ADD COLUMN stake_minutes INTEGER NOT NULL DEFAULT 60",
  "ALTER TABLE completions ADD COLUMN skip INTEGER DEFAULT 0",
  "ALTER TABLE habits ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE habits ADD COLUMN archive_periods TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE charges ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN login TEXT",
  "ALTER TABLE users ADD COLUMN time_zone TEXT",
  "ALTER TABLE users ADD COLUMN pass_hash TEXT",
  "ALTER TABLE users ADD COLUMN pass_salt TEXT",
  // сессии без срока жизни: старые строки получат его в routes/auth.js
  "ALTER TABLE sessions ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0"
]) {
  const [, table, column] = sql.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+)/);
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
  if (!exists) db.exec(sql); // Disk/permission/schema failures must abort startup.
}

// до авторизации гостевые данные писались под user_id=1; теперь гость = 0.
// Переносим их, пока id=1 не занят реальным пользователем.
try {
  const taken = db.prepare('SELECT id FROM users WHERE id = 1').get();
  if (!taken) {
    db.exec('UPDATE habits SET user_id = 0 WHERE user_id = 1');
    db.exec('UPDATE charges SET user_id = 0 WHERE user_id = 1');
  }
} catch { /* таблиц может ещё не быть */ }

/* ---------- преобразование строк БД ↔ объект фронтенда ---------- */

// строка habits + отметки → объект, который ждёт фронтенд
export function rowToHabit(row, completions = []) {
  const history = {};
  const counts = {};
  for (const c of completions) {
    if (c.skip) history[c.day] = 'skip';       // пропуск — нейтрально
    else if (c.done) history[c.day] = c.minimum ? 'min' : true;
    if (c.count) counts[c.day] = c.count;
  }
  return {
    id: row.id,
    name: row.name,
    min: row.minimum_action || '',
    icon: row.icon,
    color: row.color,
    schedule: JSON.parse(row.schedule || '[0,1,2,3,4,5,6]'),
    weekTarget: row.week_target || 0,
    buddy: row.buddy || '',
    pinned: !!row.pinned,
    archived: !!row.archived,
    archivePeriods: JSON.parse(row.archive_periods || '[]'),
    createdAt: row.created_day,
    goal: {
      type: row.goal_type,
      target: row.goal_target,
      unit: row.goal_unit || ''
    },
    stake: row.stake_mode === 'money'
      ? { mode: 'money', amount: row.stake_amount, recipient: row.stake_recipient }
      : { mode: 'lock', apps: JSON.parse(row.stake_apps || '[]'), minutes: row.stake_minutes || 60 },
    history,
    counts
  };
}

// объект фронтенда → параметры для INSERT/UPDATE
export function habitToParams(h) {
  return {
    id: String(h.id),
    name: String(h.name || ''),
    minimum_action: String(h.min || '').slice(0,60),
    icon: h.icon || '🎯',
    color: h.color || '#3B82F6',
    schedule: JSON.stringify(h.schedule?.length ? h.schedule : [0,1,2,3,4,5,6]),
    week_target: Math.max(0, Math.min(7, Number(h.weekTarget) || 0)),
    buddy: String(h.buddy || '').slice(0, 24),
    pinned: h.pinned ? 1 : 0,
    goal_type: h.goal?.type === 'count' ? 'count' : 'check',
    goal_target: Number(h.goal?.target) || 1,
    goal_unit: h.goal?.unit || '',
    stake_mode: h.stake?.mode === 'lock' ? 'lock' : 'money',
    stake_amount: Number(h.stake?.amount) || 0,
    stake_recipient: h.stake?.recipient || 'creators',
    stake_apps: JSON.stringify(h.stake?.apps || []),
    stake_minutes: Math.max(15, Math.min(1440, Number(h.stake?.minutes) || 60)),
    created_day: h.createdAt || new Date().toISOString().slice(0, 10)
  };
}
