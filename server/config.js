const path = require('path');

module.exports = {
  port: parseInt(process.env.PORT || '3001', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  dbPath: process.env.DB_PATH || path.join(__dirname, 'db', 'anyscreen.db'),
  uploadsDir: process.env.UPLOADS_DIR || path.join(__dirname, 'uploads'),
  maxFileSizeBytes: parseInt(process.env.MAX_FILE_SIZE_BYTES || String(1024 * 1024 * 1024), 10),
  heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '5000', 10),
  heartbeatTimeoutMs: parseInt(process.env.HEARTBEAT_TIMEOUT_MS || '20000', 10),
  schedulerIntervalMs: parseInt(process.env.SCHEDULER_INTERVAL_MS || '5000', 10),
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'UTC',
};
