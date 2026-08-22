const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const pairingRegistry = require('./pairingRegistry');
const previewCache = require('./previewCache');
const { pushDeviceStatus } = require('./dashboardNamespace');

const MAX_PREVIEW_BYTES = 300 * 1024;

function deviceRoom(deviceId) {
  return `device:${deviceId}`;
}

function getClientIp(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  const raw = forwarded ? String(forwarded).split(',')[0].trim() : socket.handshake.address;
  if (!raw) return null;
  return raw.startsWith('::ffff:') ? raw.slice('::ffff:'.length) : raw;
}

function pushToDevice(io, deviceId, event, payload) {
  io.of('/device').to(deviceRoom(deviceId)).emit(event, payload);
}

function notifyPlaylistViewers(io, playlistId) {
  const devices = db.prepare('SELECT id FROM devices WHERE current_playlist_id = ?').all(playlistId);
  for (const device of devices) pushToDevice(io, device.id, 'playlist:update', { playlistId });
}

function notifyContentViewers(io, contentId) {
  const devices = db.prepare('SELECT id FROM devices WHERE current_content_id = ?').all(contentId);
  for (const device of devices) pushToDevice(io, device.id, 'playlist:update', { contentId });
}

function setup(io) {
  const nsp = io.of('/device');

  nsp.on('connection', (socket) => {
    const { deviceId, token, kind } = socket.handshake.auth || {};

    if (deviceId && token) {
      const device = db.prepare('SELECT * FROM devices WHERE id = ? AND token = ?').get(deviceId, token);
      if (!device) {
        socket.emit('auth:error', { error: 'Unknown device or revoked token' });
        socket.disconnect(true);
        return;
      }
      socket.data.deviceId = device.id;
      socket.join(deviceRoom(device.id));
      db.prepare("UPDATE devices SET status = 'online', last_seen_at = datetime('now'), ip_address = ? WHERE id = ?")
        .run(getClientIp(socket), device.id);
      pushDeviceStatus(io, device.id);
      socket.emit('authenticated', { deviceId: device.id });
      return;
    }

    const { code, expiresAt } = pairingRegistry.register(socket.id, kind === 'android' ? 'android' : 'web');
    socket.data.pairingCode = code;
    socket.emit('pair:code', { code, expiresAt });

    socket.on('pair:check', () => {
      const entry = pairingRegistry.get(socket.data.pairingCode);
      if (!entry) socket.emit('pair:expired');
    });
  });

  nsp.on('connection', (socket) => {
    socket.on('heartbeat', (data = {}) => {
      const deviceId = socket.data.deviceId;
      if (!deviceId) return;
      const telemetry = JSON.stringify(data.telemetry || {});
      const isPlaying = data.playing === false ? 0 : 1;
      db.prepare(`UPDATE devices SET status = 'online', last_seen_at = datetime('now'),
                  current_item_name = ?, current_item_type = ?, telemetry_json = ?, is_playing = ?,
                  ip_address = ? WHERE id = ?`)
        .run(data.itemName || null, data.itemType || null, telemetry, isPlaying, getClientIp(socket), deviceId);
      pushDeviceStatus(io, deviceId);
    });

    socket.on('preview', (data = {}) => {
      const deviceId = socket.data.deviceId;
      if (!deviceId) return;
      let preview;
      if (typeof data.url === 'string' && data.url.length > 0 && data.url.length <= MAX_PREVIEW_BYTES) {
        preview = { type: 'image', url: data.url };
      } else if (typeof data.site === 'string' && data.site.length > 0 && data.site.length <= 300) {
        preview = { type: 'site', domain: data.site };
      } else {
        return;
      }
      previewCache.set(deviceId, preview);
      io.of('/dashboard').to('org').emit('device:preview', { deviceId, preview });
    });

    socket.on('command:ack', (data = {}) => {
      const deviceId = socket.data.deviceId;
      if (!deviceId) return;
      io.of('/dashboard').to('org').emit('command:result', { deviceId, ...data });
    });

    socket.on('disconnect', () => {
      if (socket.data.pairingCode) pairingRegistry.removeBySocketId(socket.id);
    });
  });
}

function completePairing(io, code, device) {
  const entry = pairingRegistry.get(code);
  if (!entry) return false;
  io.of('/device').to(entry.socketId).emit('pair:success', { deviceId: device.id, token: device.token });
  pairingRegistry.remove(code);
  return true;
}

module.exports = { setup, pushToDevice, deviceRoom, completePairing, notifyPlaylistViewers, notifyContentViewers };
