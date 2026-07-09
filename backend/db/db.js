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

export const db = new DatabaseSync(path.join(__dirname, 'disbit.db'));

// внешние ключи + схема
db.exec('PRAGMA foreign_keys = ON;');
db.exec(readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

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
    createdAt: row.created_day,
    goal: {
      type: row.goal_type,
      target: row.goal_target,
      unit: row.goal_unit || ''
    },
    stake: row.stake_mode === 'money'
      ? { mode: 'money', amount: row.stake_amount, recipient: row.stake_recipient }
      : { mode: 'lock', apps: JSON.parse(row.stake_apps || '[]') },
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
    goal_type: h.goal?.type === 'count' ? 'count' : 'check',
    goal_target: Number(h.goal?.target) || 1,
    goal_unit: h.goal?.unit || '',
    stake_mode: h.stake?.mode === 'lock' ? 'lock' : 'money',
    stake_amount: Number(h.stake?.amount) || 0,
    stake_recipient: h.stake?.recipient || null,
    stake_apps: JSON.stringify(h.stake?.apps || []),
    created_day: h.createdAt || new Date().toISOString().slice(0, 10)
  };
}
