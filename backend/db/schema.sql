-- ============================================================
-- disbit — схема базы данных (SQLite)
-- Используется кодом: db/db.js выполняет этот файл при старте.
-- Диалект: SQLite (легко перенести на PostgreSQL позже).
-- ============================================================

-- Пользователи (пока не используется — все данные под user_id = 1)
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Привычки (поля совпадают с объектом на фронтенде)
-- id — TEXT, потому что фронтенд генерирует свои id ('h' + timestamp)
CREATE TABLE IF NOT EXISTS habits (
  id              TEXT PRIMARY KEY,
  user_id         INTEGER NOT NULL DEFAULT 1,
  name            TEXT NOT NULL,
  icon            TEXT,
  color           TEXT,
  schedule        TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]', -- JSON: дни недели, 0=Пн
  goal_type       TEXT NOT NULL DEFAULT 'check',   -- 'check' | 'count'
  goal_target     INTEGER DEFAULT 1,
  goal_unit       TEXT,
  stake_mode      TEXT NOT NULL DEFAULT 'money',   -- 'money' | 'lock'
  stake_amount    INTEGER DEFAULT 0,               -- в рублях, если money
  stake_recipient TEXT,                            -- 'charity' | 'creators'
  stake_apps      TEXT,                            -- JSON-массив приложений, если lock
  created_day     TEXT NOT NULL,                   -- 'YYYY-MM-DD' (для стриков/автоитога)
  created_at      TEXT DEFAULT (datetime('now')),
  archived        INTEGER DEFAULT 0
);

-- Отметки выполнения по дням
CREATE TABLE IF NOT EXISTS completions (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  day      TEXT NOT NULL,            -- 'YYYY-MM-DD'
  count    INTEGER DEFAULT 0,        -- для целей-счётчиков
  done     INTEGER DEFAULT 0,        -- 1 = выполнено
  UNIQUE(habit_id, day)
);

-- Списания/блокировки (пока статус 'simulated' — без реальных платежей)
CREATE TABLE IF NOT EXISTS charges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id   TEXT NOT NULL,
  day        TEXT NOT NULL,
  name       TEXT,                                 -- имя привычки на момент списания
  icon       TEXT,
  mode       TEXT NOT NULL DEFAULT 'money',        -- 'money' | 'lock'
  amount     INTEGER NOT NULL DEFAULT 0,
  recipient  TEXT,                                 -- 'charity' | 'creators'
  apps       TEXT,                                 -- JSON-массив, если lock
  status     TEXT NOT NULL DEFAULT 'simulated',    -- 'simulated' | 'pending' | 'charged' | 'failed'
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(habit_id, day)                            -- не начисляем дважды за один день
);
