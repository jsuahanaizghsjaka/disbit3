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

-- Сессии (Bearer-токены). expires_at — мс с эпохи; окно скользящее:
-- пока пользователь заходит, срок продлевается (см. routes/auth.js).
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Обещания (поля совпадают с объектом на фронтенде)
-- id — TEXT, потому что фронтенд генерирует свои id ('h' + timestamp)
CREATE TABLE IF NOT EXISTS habits (
  id              TEXT PRIMARY KEY,
  user_id         INTEGER NOT NULL DEFAULT 0,
  name            TEXT NOT NULL,
  icon            TEXT,
  color           TEXT,
  schedule        TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]', -- JSON: дни недели, 0=Пн
  week_target     INTEGER NOT NULL DEFAULT 0,              -- 0 = строго по дням, N = «N дней в неделю»
  buddy           TEXT DEFAULT '',                        -- логин друга, если обещание совместное
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
  name       TEXT,                                 -- имя обещания на момент списания
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

-- Real-money preparation. Kept separate from the historical manual wallet so
-- simulated balances can never become withdrawable or finance a real penalty.
-- No route may use these tables until the merchant/legal release gate opens.
CREATE TABLE IF NOT EXISTS money_accounts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0 AND reserved <= balance)
);
CREATE TABLE IF NOT EXISTS money_payment_intents (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK(amount > 0),
  provider TEXT NOT NULL CHECK(provider = 'yookassa'),
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_payment_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created','pending','succeeded','canceled')),
  confirmation_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_money_payment_user ON money_payment_intents(user_id,id);
CREATE TABLE IF NOT EXISTS money_refund_requests (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK(amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','succeeded','failed','partial')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS money_refund_parts (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES money_refund_requests(id) ON DELETE RESTRICT,
  payment_intent_id TEXT NOT NULL REFERENCES money_payment_intents(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK(amount > 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_refund_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','pending','succeeded','failed'))
);
CREATE INDEX IF NOT EXISTS idx_money_refund_payment ON money_refund_parts(payment_intent_id,status);
CREATE TABLE IF NOT EXISTS money_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK(type IN ('topup','penalty','refund','correction')),
  source_key TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL CHECK(amount <> 0),
  balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_money_ledger_user ON money_ledger(user_id,id DESC);

-- YooKassa test-shop payments are display-only. Their balance cannot enter the
-- real money_* ledger, the historical manual wallet, or penalty settlement.
CREATE TABLE IF NOT EXISTS sandbox_accounts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0)
);
CREATE TABLE IF NOT EXISTS sandbox_payment_intents (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount BETWEEN 5000 AND 5000000),
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_payment_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created','pending','succeeded','canceled')),
  confirmation_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id,request_id)
);
CREATE INDEX IF NOT EXISTS idx_sandbox_intents_user ON sandbox_payment_intents(user_id,created_at);
CREATE TABLE IF NOT EXISTS sandbox_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_key TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL CHECK(amount > 0),
  balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
  provider_payment_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- A real penalty needs a fresh, explicitly accepted version of the terms.
-- Legacy promises receive no implicit consent and cannot be charged here.
CREATE TABLE IF NOT EXISTS money_terms (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  habit_id TEXT NOT NULL,
  effective_day TEXT NOT NULL,
  schedule TEXT NOT NULL,
  week_target INTEGER NOT NULL,
  goal_type TEXT NOT NULL CHECK(goal_type IN ('check','count')),
  goal_target INTEGER NOT NULL CHECK(goal_target >= 1),
  amount INTEGER NOT NULL CHECK(amount > 0),
  recipient TEXT NOT NULL CHECK(recipient = 'creators'),
  agreement_version TEXT NOT NULL,
  agreement_hash TEXT NOT NULL,
  accepted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id,habit_id,effective_day)
);
CREATE TABLE IF NOT EXISTS money_penalties (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  habit_id TEXT NOT NULL,
  day TEXT NOT NULL,
  terms_id TEXT NOT NULL REFERENCES money_terms(id),
  amount INTEGER NOT NULL CHECK(amount > 0),
  status TEXT NOT NULL CHECK(status IN ('paid','insufficient','deferred')),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id,habit_id,day)
);
CREATE INDEX IF NOT EXISTS idx_money_penalties_user ON money_penalties(user_id,day);
CREATE TABLE IF NOT EXISTS money_settlement_cursors (
  user_id INTEGER NOT NULL,
  habit_id TEXT NOT NULL,
  last_day TEXT NOT NULL,
  PRIMARY KEY(user_id,habit_id)
);

-- Друзья: настоящая связь между аккаунтами (не локальный список).
-- Дружба взаимная — при добавлении создаём ОБЕ строки, чтобы каждый видел другого.
CREATE TABLE IF NOT EXISTS friendships (
  user_id    INTEGER NOT NULL,
  friend_id  INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);

-- Intentionally no habit FK: deletion/undo must not refund the monthly allowance.
CREATE TABLE IF NOT EXISTS proof_skips (
  user_id INTEGER NOT NULL,
  habit_id TEXT NOT NULL,
  day TEXT NOT NULL,
  month TEXT NOT NULL,
  PRIMARY KEY (user_id, habit_id, day)
);
CREATE INDEX IF NOT EXISTS idx_proof_skips_month ON proof_skips(user_id, month);

-- Promise-day skips are separate from proof skips. A receipt is never refunded
-- by undoing a mark or deleting a promise.
CREATE TABLE IF NOT EXISTS promise_day_skips (
  user_id INTEGER NOT NULL, habit_id TEXT NOT NULL, day TEXT NOT NULL,
  month TEXT NOT NULL, PRIMARY KEY(user_id,habit_id,day)
);
CREATE INDEX IF NOT EXISTS idx_promise_day_skips_month ON promise_day_skips(user_id,month);
CREATE TABLE IF NOT EXISTS promise_skip_purchases (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, month TEXT NOT NULL,
  cost_bits INTEGER NOT NULL CHECK(cost_bits=20), created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_promise_skip_purchases_month ON promise_skip_purchases(user_id,month);
-- Only server-verified completions mint spendable bits. Historical local profile
-- bits remain cosmetic and cannot waive a real-money penalty.
CREATE TABLE IF NOT EXISTS trusted_bits (
  user_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS trusted_bit_awards (
  user_id INTEGER NOT NULL, habit_id TEXT NOT NULL, day TEXT NOT NULL,
  PRIMARY KEY(user_id,habit_id,day)
);

-- Приглашения «делать обещание вместе»: короткий код → ссылка/QR.
-- payload — снимок обещания (название, иконка, расписание…), чтобы у друга
-- создалась ТАКАЯ ЖЕ. Код постоянный для пары (владелец + обещание).
CREATE TABLE IF NOT EXISTS habit_invites (
  code       TEXT PRIMARY KEY,
  owner_id   INTEGER NOT NULL,
  habit_id   TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(owner_id, habit_id)
);
