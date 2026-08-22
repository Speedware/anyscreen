const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

function migrateRotationColumn() {
  const info = db.prepare('PRAGMA table_info(devices)').all();
  const orientationCol = info.find((c) => c.name === 'orientation');
  const rotationCol = info.find((c) => c.name === 'rotation');
  const rotationNeedsRepair = rotationCol && rotationCol.type.toUpperCase() !== 'INTEGER';
  if (!orientationCol && !rotationNeedsRepair) return;

  const sourceExpr = orientationCol
    ? "CASE WHEN orientation = 'portrait' THEN 90 ELSE 0 END"
    : 'CAST(rotation AS INTEGER)';

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE devices_new (
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
        current_playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL,
        current_item_name TEXT,
        current_item_type TEXT,
        is_playing INTEGER NOT NULL DEFAULT 1,
        telemetry_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`
      INSERT INTO devices_new (id, name, kind, pairing_code, token, status, last_seen_at, rotation,
        notes, default_playlist_id, current_playlist_id, current_item_name, current_item_type,
        telemetry_json, created_at)
      SELECT id, name, kind, pairing_code, token, status, last_seen_at,
        ${sourceExpr},
        notes, default_playlist_id, current_playlist_id, current_item_name, current_item_type,
        telemetry_json, created_at
      FROM devices
    `);
    db.exec('DROP TABLE devices');
    db.exec('ALTER TABLE devices_new RENAME TO devices');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
migrateRotationColumn();

function migrateAddIsPlayingColumn() {
  const columns = db.prepare('PRAGMA table_info(devices)').all().map((c) => c.name);
  if (columns.includes('is_playing')) return;
  db.exec('ALTER TABLE devices ADD COLUMN is_playing INTEGER NOT NULL DEFAULT 1');
}
migrateAddIsPlayingColumn();

function migrateAddAutoscaleColumn() {
  const columns = db.prepare('PRAGMA table_info(devices)').all().map((c) => c.name);
  if (columns.includes('autoscale')) return;
  db.exec('ALTER TABLE devices ADD COLUMN autoscale INTEGER NOT NULL DEFAULT 1');
}
migrateAddAutoscaleColumn();

function migrateAddDeviceMiscColumns() {
  const columns = db.prepare('PRAGMA table_info(devices)').all().map((c) => c.name);
  if (!columns.includes('current_content_id')) {
    db.exec('ALTER TABLE devices ADD COLUMN current_content_id TEXT REFERENCES content(id) ON DELETE SET NULL');
  }
  if (!columns.includes('ip_address')) {
    db.exec('ALTER TABLE devices ADD COLUMN ip_address TEXT');
  }
  if (!columns.includes('default_content_id')) {
    db.exec('ALTER TABLE devices ADD COLUMN default_content_id TEXT REFERENCES content(id) ON DELETE SET NULL');
  }
}
migrateAddDeviceMiscColumns();

function migrateSchedulesContentTarget() {
  const columns = db.prepare('PRAGMA table_info(schedules)').all().map((c) => c.name);
  if (columns.includes('content_id')) return;

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE schedules_new (
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
      )
    `);
    db.exec(`
      INSERT INTO schedules_new (id, name, playlist_id, content_id, days_of_week, start_time, end_time,
        timezone, priority, enabled, created_at, updated_at)
      SELECT id, name, playlist_id, NULL, days_of_week, start_time, end_time,
        timezone, priority, enabled, created_at, updated_at
      FROM schedules
    `);
    db.exec('DROP TABLE schedules');
    db.exec('ALTER TABLE schedules_new RENAME TO schedules');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
migrateSchedulesContentTarget();

function migrateAddDevicePosition() {
  const columns = db.prepare('PRAGMA table_info(devices)').all().map((c) => c.name);
  if (columns.includes('position')) return;
  db.exec('ALTER TABLE devices ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    UPDATE devices SET position = (
      SELECT COUNT(*) FROM devices d2
      WHERE d2.created_at < devices.created_at
         OR (d2.created_at = devices.created_at AND d2.id < devices.id)
    )
  `);
}
migrateAddDevicePosition();

function migrateAddPlaylistMuteAudio() {
  const columns = db.prepare('PRAGMA table_info(playlists)').all().map((c) => c.name);
  if (columns.includes('mute_audio')) return;
  db.exec('ALTER TABLE playlists ADD COLUMN mute_audio INTEGER NOT NULL DEFAULT 0');
}
migrateAddPlaylistMuteAudio();

function migrateAddContentProcessingStatus() {
  const columns = db.prepare('PRAGMA table_info(content)').all().map((c) => c.name);
  if (columns.includes('processing_status')) return;
  db.exec("ALTER TABLE content ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'ready'");
}
migrateAddContentProcessingStatus();

function migrateAddContentOptimizedFlag() {
  const columns = db.prepare('PRAGMA table_info(content)').all().map((c) => c.name);
  if (columns.includes('optimized')) return;
  db.exec('ALTER TABLE content ADD COLUMN optimized INTEGER NOT NULL DEFAULT 0');
}
migrateAddContentOptimizedFlag();

function migrateAddVideoOptimizationSetting() {
  const columns = db.prepare('PRAGMA table_info(settings)').all().map((c) => c.name);
  if (columns.includes('video_optimization_enabled')) return;
  db.exec('ALTER TABLE settings ADD COLUMN video_optimization_enabled INTEGER NOT NULL DEFAULT 1');
}
migrateAddVideoOptimizationSetting();

db.exec("INSERT OR IGNORE INTO settings (id, default_timezone) VALUES (1, 'Europe/Moscow')");

module.exports = db;
