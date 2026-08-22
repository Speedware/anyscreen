CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'viewer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('video', 'image', 'website')),
  source TEXT NOT NULL CHECK (source IN ('upload', 'url')),
  location TEXT NOT NULL,
  duration_seconds INTEGER,
  muted INTEGER NOT NULL DEFAULT 0,
  thumbnail_path TEXT,
  processing_status TEXT NOT NULL DEFAULT 'ready' CHECK (processing_status IN ('processing', 'ready')),
  optimized INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mute_audio INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playlist_items (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  content_id TEXT NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  duration_override INTEGER
);

CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id, position);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('android', 'web')),
  pairing_code TEXT UNIQUE,
  token TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
  last_seen_at TEXT,
  rotation INTEGER NOT NULL DEFAULT 0 CHECK (rotation IN (0, 90, 180, 270)),
  notes TEXT,
  default_playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL,
  default_content_id TEXT REFERENCES content(id) ON DELETE SET NULL,
  current_playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL,
  current_content_id TEXT REFERENCES content(id) ON DELETE SET NULL,
  current_item_name TEXT,
  current_item_type TEXT,
  is_playing INTEGER NOT NULL DEFAULT 1,
  autoscale INTEGER NOT NULL DEFAULT 1,
  telemetry_json TEXT,
  ip_address TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Exactly one of playlist_id / content_id is set — a schedule plays either a whole playlist or
-- a single content item directly, without having to wrap that one file in a playlist first.
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  playlist_id TEXT REFERENCES playlists(id) ON DELETE CASCADE,
  content_id TEXT REFERENCES content(id) ON DELETE CASCADE,
  days_of_week TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((playlist_id IS NOT NULL) != (content_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS schedule_devices (
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  PRIMARY KEY (schedule_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_devices_device ON schedule_devices(device_id);

-- Single-row app-wide config (id is always 1) — currently just the default timezone suggested
-- when creating a new schedule.
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  default_timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
  video_optimization_enabled INTEGER NOT NULL DEFAULT 1
);
