-- ==========================================================
-- schema.sql — Planstrator veritabanı şeması (SQLite)
--
-- TABLO: aynı türden kayıtların listesi (JavaScript'teki nesne dizisi gibi).
-- SÜTUN: her kaydın bir alanı; her sütunun bir veri tipi vardır:
--   INTEGER tam sayı · REAL ondalıklı sayı · TEXT metin
-- PRIMARY KEY (birincil anahtar): her satırı benzersiz tanımlayan sütun(lar).
-- FOREIGN KEY / REFERENCES (yabancı anahtar): başka bir tablodaki satıra işaret eder;
--   frontend'de "categoryId ile kategoriyi bulmak" neyse veritabanında da odur.
-- ON DELETE CASCADE: işaret edilen satır silinirse bu satır da silinir.
-- NOT NULL: boş bırakılamaz · UNIQUE: aynı değer iki kez olamaz · DEFAULT: varsayılan değer
-- ==========================================================

-- ---------- Kullanıcılar ve oturumlar ----------

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,          -- küçük harfle saklanır
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,                 -- parolanın kendisi ASLA saklanmaz
  email_verified INTEGER NOT NULL DEFAULT 0,   -- 0: doğrulanmadı, 1: doğrulandı (SQLite'ta ayrı bir evet/hayır tipi yoktur)
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- E-posta doğrulama bağlantıları. Mailde rastgele bir anahtar gider; burada özeti saklanır.
-- Bağlantıya tıklanınca satır silinir (tek kullanımlık) ve süresi dolunca geçersizdir.
CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Giriş yapan her cihaz için bir satır. Tarayıcıdaki çerezde rastgele bir anahtar durur;
-- burada o anahtarın özeti (hash) saklanır, böylece veritabanı sızsa bile oturum çalınamaz.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL                  -- zaman damgası (ms)
);

-- ---------- Kişisel veriler (buluta yedek) ----------
-- Kimlikler (id) frontend'de üretildiği için TEXT'tir ve kullanıcıya özeldir:
-- birincil anahtar (user_id, id) çiftidir.

CREATE TABLE IF NOT EXISTS categories (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id      TEXT NOT NULL,
  name    TEXT NOT NULL,
  color   TEXT NOT NULL,
  icon    TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS tasks (
  user_id           INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id                TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  priority          TEXT NOT NULL DEFAULT 'normal',
  category_id       TEXT,                      -- categories.id (kategorisizse NULL)
  due_date          TEXT NOT NULL DEFAULT '',  -- 'YYYY-AA-GG'
  start_time        TEXT NOT NULL DEFAULT '',
  estimated_minutes INTEGER NOT NULL DEFAULT 0,
  spent_minutes     INTEGER NOT NULL DEFAULT 0,
  recurrence        TEXT NOT NULL DEFAULT 'none',
  sort_order        REAL NOT NULL DEFAULT 0,
  tags              TEXT NOT NULL DEFAULT '[]', -- JSON dizi
  subtasks          TEXT NOT NULL DEFAULT '[]', -- JSON dizi
  created_at        TEXT NOT NULL DEFAULT '',
  completed_at      TEXT,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS pomodoro_sessions (
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  type       TEXT NOT NULL,
  task_id    TEXT,
  date       TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER NOT NULL,
  minutes    INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS goals (
  user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id            TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  type          TEXT NOT NULL DEFAULT 'numeric',
  target_value  REAL NOT NULL DEFAULT 1,
  current_value REAL NOT NULL DEFAULT 0,
  unit          TEXT NOT NULL DEFAULT '',
  start_date    TEXT NOT NULL DEFAULT '',
  end_date      TEXT NOT NULL DEFAULT '',
  category_id   TEXT,
  created_at    TEXT NOT NULL DEFAULT '',
  completed_at  TEXT,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS checklist_templates (
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  items       TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (user_id, id)
);

-- Kendi tablosu olmayan bölümler (ayarlar, notlar, seyahatler, alışkanlıklar, çizim...)
-- tek bir JSON metni olarak saklanır.
CREATE TABLE IF NOT EXISTS user_extras (
  user_id    INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ---------- Ortak panolar (grup çalışması) ----------

CREATE TABLE IF NOT EXISTS boards (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  owner_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Çoka-çok ilişki: bir kullanıcı birçok panoda, bir panoda birçok kullanıcı olabilir.
-- Bu ilişki araya üçüncü bir tablo koyarak kurulur.
CREATE TABLE IF NOT EXISTS board_members (
  board_id INTEGER NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role     TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  PRIMARY KEY (board_id, user_id)
);

-- E-posta ile gönderilen, henüz kabul edilmemiş davetler.
CREATE TABLE IF NOT EXISTS board_invites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id   INTEGER NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  invited_by INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (board_id, email)
);

CREATE TABLE IF NOT EXISTS board_tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id    INTEGER NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  due_date    TEXT NOT NULL DEFAULT '',
  assignee_id INTEGER REFERENCES users (id) ON DELETE SET NULL, -- görevi üstlenen üye
  sort_order  REAL NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- İNDEKS: sık aranan sütunlarda aramayı hızlandırır (kitabın arkasındaki dizin gibi).
CREATE INDEX IF NOT EXISTS idx_board_tasks_board ON board_tasks (board_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_board_invites_email ON board_invites (email);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
