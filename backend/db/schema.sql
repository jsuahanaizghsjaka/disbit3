-- ============================================================
-- disbit — схема базы данных (SQLite)
-- Используется кодом: db/db.js выполняет этот файл при старте.
-- Диалект: SQLite (легко перенести на PostgreSQL позже).
-- ============================================================

-- Пользователи (вход по логину или почте + пароль)
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  login      TEXT UNIQUE NOT NULL,
  email      TEXT UNIQUE NOT NULL,
  pass_hash  TEXT NOT NULL,               -- scrypt-хэш пароля
  pass_salt  TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Сессии (Bearer-токены)
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Привычки (поля совпадают с объектом на фронтенде)
-- id — TEXT, потому что фронтенд генерирует свои id ('h' + timestamp)
CREATE TABLE IF NOT EXISTS habits (
  id              TEXT PRIMARY KEY,
  user_id         INTEGER NOT NULL DEFAULT 0,
  name            TEXT NOT NULL,
  icon            TEXT,
  color           TEXT,
  schedule        TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]', -- JSON: дни недели, 0=Пн
  week_target     INTEGER NOT NULL DEFAULT 0,              -- 0 = строго по дням, N = «N дней в неделю»
  pinned          INTEGER NOT NULL DEFAULT 0,              -- закреплена наверху списка
  goal_type       TEXT NOT NULL DEFAULT 'check',   -- 'check' | 'count'
  goal_target     INTEGER DEFAULT 1,
  goal_unit       TEXT,
  stake_mode      TEXT NOT NULL DEFAULT 'money',   -- 'money' | 'lock'
  stake_amount    INTEGER DEFAULT 0,               -- в рублях, если money
  stake_recipient TEXT,                            -- 'charity' | 'creators'
  stake_apps      TEXT,                            -- JSON-массив приложений, если lock
  stake_minutes   INTEGER NOT NULL DEFAULT 60,     -- на сколько блокируем, минут
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

-- Состояние профиля одним JSON-блобом (profile/goals/rewards/friends/backlog/settings)
CREATE TABLE IF NOT EXISTS user_state (
  user_id    INTEGER PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL              -- клиентская метка (мс с эпохи, строкой)
);

-- Списания/блокировки (пока статус 'simulated' — без реальных платежей)
CREATE TABLE IF NOT EXISTS charges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL DEFAULT 0,
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
