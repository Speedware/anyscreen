const db = require('../db');
const config = require('../config');
const { resolveActiveTarget } = require('./resolvePlaylist');
const { pushToDevice } = require('../ws/deviceNamespace');
const { pushDeviceStatus } = require('../ws/dashboardNamespace');

function tick(io) {
  const devices = db.prepare('SELECT id, current_playlist_id, current_content_id FROM devices').all();
  const now = new Date();

  for (const device of devices) {
    const target = resolveActiveTarget(device.id, now);
    if (target.playlistId === device.current_playlist_id && target.contentId === device.current_content_id) continue;

    db.prepare('UPDATE devices SET current_playlist_id = ?, current_content_id = ? WHERE id = ?')
      .run(target.playlistId, target.contentId, device.id);
    pushToDevice(io, device.id, 'playlist:update', target);
    pushDeviceStatus(io, device.id);
  }
}

function start(io) {
  const timer = setInterval(() => tick(io), config.schedulerIntervalMs);
  timer.unref();
  tick(io);
  return timer;
}

module.exports = { start, tick };
