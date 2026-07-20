/* ============================================================
   Подключение к SQLite через встроенный node:sqlite.
   Требуется Node.js ≥ 22.13 (или 23+). Никаких нативных
   зависимостей — база лежит в файле db/disbit.db.
   ============================================================ */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DB_PATH задаёт хостинг (persistent volume), локально — файл рядом
export const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'disbit.db'));

// внешние ключи + схема
db.exec('PRAGMA foreign_keys = ON;');
db.exec(readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// мягкие миграции для баз, созданных до появления авторизации
for (const sql of [
  "ALTER TABLE habits ADD COLUMN week_target INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE habits ADD COLUMN stake_minutes INTEGER NOT NULL DEFAULT 60",
  "ALTER TABLE habits ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE charges ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE users ADD COLUMN login TEXT",
  "ALTER TABLE users ADD COLUMN pass_hash TEXT",
  "ALTER TABLE users ADD COLUMN pass_salt TEXT"
]) {
  try { db.exec(sql); } catch { /* колонка уже есть */ }
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
    if (c.done) history[c.day] = true;
    if (c.count) counts[c.day] = c.count;
  }
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    schedule: JSON.parse(row.schedule || '[0,1,2,3,4,5,6]'),
    weekTarget: row.week_target || 0,
    pinned: !!row.pinned,
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
    icon: h.icon || '🎯',
    color: h.color || '#3B82F6',
    schedule: JSON.stringify(h.schedule?.length ? h.schedule : [0,1,2,3,4,5,6]),
    week_target: Math.max(0, Math.min(7, Number(h.weekTarget) || 0)),
    pinned: h.pinned ? 1 : 0,
    goal_type: h.goal?.type === 'count' ? 'count' : 'check',
    goal_target: Number(h.goal?.target) || 1,
    goal_unit: h.goal?.unit || '',
    stake_mode: h.stake?.mode === 'lock' ? 'lock' : 'money',
    stake_amount: Number(h.stake?.amount) || 0,
    stake_recipient: h.stake?.recipient || null,
    stake_apps: JSON.stringify(h.stake?.apps || []),
    stake_minutes: Math.max(15, Math.min(1440, Number(h.stake?.minutes) || 60)),
    created_day: h.createdAt || new Date().toISOString().slice(0, 10)
  };
}
