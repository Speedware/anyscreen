const db = require('../db');
const config = require('../config');
const { pushDeviceStatus } = require('../ws/dashboardNamespace');

function sweep(io) {
  const cutoff = new Date(Date.now() - config.heartbeatTimeoutMs).toISOString().replace('T', ' ').slice(0, 19);
  const stale = db.prepare(`
    SELECT id FROM devices
    WHERE status = 'online' AND (last_seen_at IS NULL OR last_seen_at < ?)
  `).all(cutoff);

  for (const device of stale) {
    db.prepare("UPDATE devices SET status = 'offline' WHERE id = ?").run(device.id);
    pushDeviceStatus(io, device.id);
  }
}

function start(io) {
  const timer = setInterval(() => sweep(io), config.heartbeatIntervalMs);
  timer.unref();
  return timer;
}

module.exports = { start, sweep };
