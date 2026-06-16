-- ============================================================
-- disbit — схема базы данных (для будущего подключения)
-- Диалект: SQLite (легко перенести на PostgreSQL позже).
-- Пока НЕ используется кодом — это заготовка структуры.
-- ============================================================

-- Пользователи
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Привычки (поля совпадают с объектом на фронтенде)
CREATE TABLE IF NOT EXISTS habits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  name            TEXT NOT NULL,
  icon            TEXT,
  color           TEXT,
  goal_type       TEXT NOT NULL DEFAULT 'check',   -- 'check' | 'count'
  goal_target     INTEGER DEFAULT 1,
  goal_unit       TEXT,
  stake_mode      TEXT NOT NULL DEFAULT 'money',   -- 'money' | 'lock'
  stake_amount    INTEGER DEFAULT 0,               -- в рублях, если money
  stake_recipient TEXT,                            -- 'charity' | 'creators'
  stake_apps      TEXT,                            -- JSON-массив приложений, если lock
  created_at      TEXT DEFAULT (datetime('now')),
  archived        INTEGER DEFAULT 0
);

-- Отметки выполнения по дням
CREATE TABLE IF NOT EXISTS completions (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id INTEGER NOT NULL REFERENCES habits(id),
  day      TEXT NOT NULL,            -- 'YYYY-MM-DD'
  count    INTEGER DEFAULT 0,        -- для целей-счётчиков
  done     INTEGER DEFAULT 0,        -- 1 = выполнено
  UNIQUE(habit_id, day)
);

-- Списания/блокировки (пока статус 'simulated' — без реальных платежей)
CREATE TABLE IF NOT EXISTS charges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id   INTEGER NOT NULL REFERENCES habits(id),
  day        TEXT NOT NULL,
  amount     INTEGER NOT NULL DEFAULT 0,
  recipient  TEXT,                              -- 'charity' | 'creators'
  status     TEXT NOT NULL DEFAULT 'simulated', -- 'simulated' | 'pending' | 'charged' | 'failed'
  created_at TEXT DEFAULT (datetime('now'))
);
