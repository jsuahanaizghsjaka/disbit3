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
  email_verified INTEGER NOT NULL DEFAULT 0,   -- почта подтверждена кодом из письма
  created_at TEXT DEFAULT (datetime('now'))
);

-- Коды подтверждения почты (живут 15 минут, счётчик попыток от перебора)
CREATE TABLE IF NOT EXISTS email_codes (
  user_id    INTEGER PRIMARY KEY,
  code       TEXT NOT NULL,
  expires_at INTEGER NOT NULL,                 -- мс с эпохи
  attempts   INTEGER NOT NULL DEFAULT 0,
  sent_at    INTEGER NOT NULL DEFAULT 0        -- чтобы не спамить «отправить ещё раз»
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
  buddy           TEXT DEFAULT '',                        -- логин друга, если привычка совместная
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
  skip     INTEGER DEFAULT 0,        -- 1 = пропуск (нейтрально: серия стоит, штрафа нет)
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

-- Пруфы выполнения: живое фото/видео, которое пользователь снял в подтверждение.
-- Файл лежит в PROOFS_DIR (на volume рядом с базой), здесь только метаданные.
CREATE TABLE IF NOT EXISTS proofs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL DEFAULT 0,
  user_login  TEXT,                                 -- чтобы в панели видеть, кто прислал
  habit_id    TEXT NOT NULL,
  habit_name  TEXT,
  day         TEXT NOT NULL,                        -- 'YYYY-MM-DD'
  type        TEXT NOT NULL DEFAULT 'photo',        -- 'photo' | 'video'
  file        TEXT NOT NULL,                        -- имя файла в PROOFS_DIR
  mime        TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',      -- 'pending' | 'approved' | 'rejected'
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_proofs_status ON proofs(status, id);

-- ДЕПОЗИТ (кошелёк). Модель: пользователь заранее пополняет баланс, а при
-- пропуске сумма списывается ОТСЮДА, а не с карты. Так нет рекуррентных
-- списаний (меньше юридических и технических рисков), а деньги уже у нас.
-- Все суммы — в КОПЕЙКАХ целыми числами: дробные рубли дают ошибки округления.
CREATE TABLE IF NOT EXISTS wallets (
  user_id    INTEGER PRIMARY KEY,
  balance    INTEGER NOT NULL DEFAULT 0,      -- копейки
  currency   TEXT NOT NULL DEFAULT 'RUB',
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Движения по кошельку. Пишем ВСЁ: пополнения, списания, возвраты, выплаты.
-- provider_id — id платежа у провайдера, по нему сверяемся и не зачисляем дважды.
CREATE TABLE IF NOT EXISTS transactions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  type         TEXT NOT NULL,                 -- 'topup' | 'charge' | 'refund' | 'payout'
  amount       INTEGER NOT NULL,              -- копейки: + приход, − расход
  balance_after INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'done',  -- 'pending' | 'done' | 'failed' | 'canceled'
  provider     TEXT,                          -- 'yookassa' | 'tbank' | 'manual'
  provider_id  TEXT,                          -- id платежа на стороне провайдера
  meta         TEXT,                          -- JSON: habit_id, day, recipient…
  created_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(provider, provider_id)               -- вебхук может прийти дважды
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, id DESC);

-- Друзья: настоящая связь между аккаунтами (не локальный список).
-- Дружба взаимная — при добавлении создаём ОБЕ строки, чтобы каждый видел другого.
CREATE TABLE IF NOT EXISTS friendships (
  user_id    INTEGER NOT NULL,
  friend_id  INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);

-- Приглашения «делать привычку вместе»: короткий код → ссылка/QR.
-- payload — снимок привычки (название, иконка, расписание…), чтобы у друга
-- создалась ТАКАЯ ЖЕ. Код постоянный для пары (владелец + привычка).
CREATE TABLE IF NOT EXISTS habit_invites (
  code       TEXT PRIMARY KEY,
  owner_id   INTEGER NOT NULL,
  habit_id   TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(owner_id, habit_id)
);
