-- ---------------------------------------------------------------------------
-- Routine Tracker — database schema
--
-- Everything is scoped to a user. Deleting a user cascades to every row that
-- belongs to them, so account deletion is a single statement.
-- Dates are stored as ISO strings ('YYYY-MM-DD') and timestamps as ISO 8601
-- UTC strings, which keeps them sortable and comparable with plain SQL.
-- ---------------------------------------------------------------------------

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT    NOT NULL,
  password_hash  TEXT    NOT NULL,
  avatar_color   TEXT    NOT NULL DEFAULT '#6366f1',
  timezone       TEXT    NOT NULL DEFAULT 'UTC',
  locale         TEXT    NOT NULL DEFAULT 'en',
  theme          TEXT    NOT NULL DEFAULT 'dark',
  week_start     INTEGER NOT NULL DEFAULT 1,   -- 0 = Sunday, 1 = Monday
  daily_goal     INTEGER NOT NULL DEFAULT 80,  -- target completion rate in %
  reminders_on   INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- A goal is the *why* a routine exists: the thing the daily work adds up to.
-- Goals are optional; a routine with goal_id NULL is simply not tied to one.
-- Deleting a goal keeps its routines and only clears the link.
CREATE TABLE IF NOT EXISTS goals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  icon         TEXT    NOT NULL DEFAULT '🎯',
  color        TEXT    NOT NULL DEFAULT '#6366f1',
  target_date  TEXT,                                -- 'YYYY-MM-DD', NULL = open ended
  status       TEXT    NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','done','archived')),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id, status);

-- A routine is the *definition* of a recurring piece of work: what it is, when
-- it should happen and how often it repeats.
CREATE TABLE IF NOT EXISTS routines (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id        INTEGER REFERENCES goals(id) ON DELETE SET NULL,  -- NULL = no goal
  title          TEXT    NOT NULL,
  notes          TEXT    NOT NULL DEFAULT '',
  icon           TEXT    NOT NULL DEFAULT '✅',
  color          TEXT    NOT NULL DEFAULT '#6366f1',
  category       TEXT    NOT NULL DEFAULT 'personal',
  priority       TEXT    NOT NULL DEFAULT 'normal'   -- low | normal | high
                 CHECK (priority IN ('low','normal','high')),

  start_time     TEXT,                                -- 'HH:MM', NULL = anytime
  duration_min   INTEGER NOT NULL DEFAULT 0,          -- 0 = unspecified

  -- Recurrence -------------------------------------------------------------
  repeat_type    TEXT    NOT NULL DEFAULT 'daily'
                 CHECK (repeat_type IN ('daily','weekly','interval','monthly','once')),
  repeat_days    TEXT    NOT NULL DEFAULT '',   -- weekly: '1,3,5' (0=Sun) | monthly: '1,15'
  repeat_every   INTEGER NOT NULL DEFAULT 1,    -- interval: every N days
  start_date     TEXT    NOT NULL,              -- first day the routine is active
  end_date       TEXT,                          -- NULL = no end

  -- Measurement ------------------------------------------------------------
  goal_type      TEXT    NOT NULL DEFAULT 'check'
                 CHECK (goal_type IN ('check','quantity')),
  target_value   REAL    NOT NULL DEFAULT 1,
  unit           TEXT    NOT NULL DEFAULT '',

  reminder_min   INTEGER,                       -- minutes before start_time
  sort_order     INTEGER NOT NULL DEFAULT 0,
  archived       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_routines_user     ON routines(user_id, archived);
CREATE INDEX IF NOT EXISTS idx_routines_schedule ON routines(user_id, start_date, end_date);

-- One row per routine per day. The unique constraint makes "toggle done" an
-- idempotent upsert instead of a read-modify-write race.
CREATE TABLE IF NOT EXISTS logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id   INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  log_date     TEXT    NOT NULL,                -- 'YYYY-MM-DD'
  status       TEXT    NOT NULL DEFAULT 'done'
               CHECK (status IN ('done','skipped','partial')),
  value        REAL    NOT NULL DEFAULT 0,      -- progress for quantity goals
  note         TEXT    NOT NULL DEFAULT '',
  completed_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (routine_id, log_date)
);

CREATE INDEX IF NOT EXISTS idx_logs_user_date ON logs(user_id, log_date);
CREATE INDEX IF NOT EXISTS idx_logs_routine   ON logs(routine_id, log_date);

-- Free-form daily journal plus a mood/energy check-in.
CREATE TABLE IF NOT EXISTS journal (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date  TEXT    NOT NULL,
  mood        INTEGER,                          -- 1..5
  energy      INTEGER,                          -- 1..5
  body        TEXT    NOT NULL DEFAULT '',
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (user_id, entry_date)
);

-- Unlocked achievements. `progress` lets the UI show "7 / 30" for locked ones.
CREATE TABLE IF NOT EXISTS achievements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code         TEXT    NOT NULL,
  unlocked_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (user_id, code)
);

-- Long-lived login sessions. Storing them lets a user sign out of one device
-- and lets us revoke everything on a password change.
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT    PRIMARY KEY,             -- random token id, embedded in the JWT
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent  TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_seen   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
