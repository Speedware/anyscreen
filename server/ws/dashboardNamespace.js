const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const previewCache = require('./previewCache');

const ORG_ROOM = 'org';

function serializeDevice(device) {
  if (!device) return null;
  let telemetry = {};
  try { telemetry = JSON.parse(device.telemetry_json || '{}'); } catch { }
  return {
    id: device.id,
    name: device.name,
    kind: device.kind,
    status: device.status,
    lastSeenAt: device.last_seen_at,
    ipAddress: device.ip_address,
    rotation: device.rotation,
    position: device.position,
    autoscale: !!device.autoscale,
    notes: device.notes,
    defaultPlaylistId: device.default_playlist_id,
    defaultContentId: device.default_content_id,
    currentPlaylistId: device.current_playlist_id,
    currentContentId: device.current_content_id,
    currentItemName: device.current_item_name,
    currentItemType: device.current_item_type,
    isPlaying: !!device.is_playing,
    preview: previewCache.get(device.id),
    telemetry,
  };
}

function setup(io) {
  const nsp = io.of('/dashboard');

  nsp.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Missing token'));
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      const user = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(payload.sub);
      if (!user) return next(new Error('Invalid token'));
      socket.data.user = user;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  nsp.on('connection', (socket) => {
    socket.join(ORG_ROOM);
  });
}

function pushDeviceStatus(io, deviceId) {
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  io.of('/dashboard').to(ORG_ROOM).emit('device:status', serializeDevice(device));
}

module.exports = { setup, pushDeviceStatus, serializeDevice, ORG_ROOM };
