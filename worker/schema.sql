-- Live hostel plans: one person (with the edit key) updates, everyone follows.
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  edit_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  place TEXT NOT NULL,
  settings TEXT NOT NULL,
  sensitive INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL
);

-- Anonymous calibrated room settings, at ~11 km precision, shared by opt-in.
CREATE TABLE IF NOT EXISTS community (
  device TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  sun TEXT,
  closed_mix REAL,
  sun_scale REAL,
  open_mix REAL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS community_pos ON community (lat, lon);

-- Web push subscriptions with the place and settings to plan for.
CREATE TABLE IF NOT EXISTS push_subs (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  place TEXT NOT NULL,
  settings TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'en',
  last_key TEXT,
  message TEXT,
  updated INTEGER NOT NULL
);

-- Telegram: short-lived link codes, then subscribed chats.
CREATE TABLE IF NOT EXISTS tg_links (
  code TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tg_subs (
  chat_id INTEGER PRIMARY KEY,
  place TEXT NOT NULL,
  settings TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'en',
  last_key TEXT,
  updated INTEGER NOT NULL
);

-- Small cache and rate-limit store.
CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  expires INTEGER NOT NULL
);
