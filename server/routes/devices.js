const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { requireDevice } = require('../middleware/deviceAuth');
const { serializeDevice, pushDeviceStatus } = require('../ws/dashboardNamespace');
const { completePairing, pushToDevice } = require('../ws/deviceNamespace');
const { getPlayableForTarget, resolveActiveTarget, getSchedulesForDevice } = require('../services/resolvePlaylist');
const pairingRegistry = require('../ws/pairingRegistry');
const previewCache = require('../ws/previewCache');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const devices = db.prepare('SELECT * FROM devices ORDER BY position, created_at').all();
  res.json({ devices: devices.map(serializeDevice) });
});

router.put('/reorder', requireAuth, requireAdmin, (req, res) => {
  const { order } = req.body || {};
  if (!Array.isArray(order) || order.length === 0) return res.status(400).json({ error: 'order must be a non-empty array of device ids' });

  const io = req.app.get('io');
  const update = db.prepare('UPDATE devices SET position = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    order.forEach((id, index) => update.run(index, id));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  io.of('/dashboard').to('org').emit('device:reorder', { order });
  res.json({ ok: true });
});

router.get('/:id', requireAuth, (req, res) => {
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  res.json({ device: serializeDevice(device) });
});

function nextAutoName() {
  const existing = new Set(db.prepare('SELECT name FROM devices').all().map((d) => d.name));
  let n = 1;
  while (existing.has(`Display ${n}`)) n += 1;
  return `Display ${n}`;
}

router.post('/pair', requireAuth, requireAdmin, (req, res) => {
  const { code } = req.body || {};
  const name = (req.body?.name || '').trim();
  if (!code) return res.status(400).json({ error: 'code is required' });

  const io = req.app.get('io');
  const entry = pairingRegistry.get(code);
  if (!entry) return res.status(404).json({ error: 'Pairing code not found or expired' });

  const id = uuidv4();
  const token = uuidv4();
  const nextPosition = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM devices').get().next;
  db.prepare(`INSERT INTO devices (id, name, kind, token, status, position) VALUES (?, ?, ?, ?, 'offline', ?)`)
    .run(id, name || nextAutoName(), entry.kind, token, nextPosition);

  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
  completePairing(io, code, device);
  res.status(201).json({ device: serializeDevice(device) });
});

router.post('/:id/repair', requireAuth, requireAdmin, (req, res) => {
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code is required' });

  const io = req.app.get('io');
  const entry = pairingRegistry.get(code);
  if (!entry) return res.status(404).json({ error: 'Pairing code not found or expired' });

  const token = uuidv4();
  db.prepare('UPDATE devices SET token = ?, kind = ?, status = ? WHERE id = ?')
    .run(token, entry.kind, 'offline', device.id);

  const updated = db.prepare('SELECT * FROM devices WHERE id = ?').get(device.id);
  completePairing(io, code, updated);
  res.json({ device: serializeDevice(updated) });
});

router.patch('/:id', requireAuth, requireAdmin, (req, res) => {
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const { name, rotation, notes, defaultPlaylistId, defaultContentId, autoscale } = req.body || {};
  if (rotation !== undefined && ![0, 90, 180, 270].includes(Number(rotation))) {
    return res.status(400).json({ error: 'rotation must be one of 0, 90, 180, 270' });
  }
  db.prepare(`UPDATE devices SET name = ?, rotation = ?, notes = ?, default_playlist_id = ?,
              default_content_id = ?, autoscale = ? WHERE id = ?`)
    .run(
      name ?? device.name,
      rotation !== undefined ? Number(rotation) : device.rotation,
      notes ?? device.notes,
      defaultPlaylistId !== undefined ? (defaultPlaylistId || null) : device.default_playlist_id,
      defaultContentId !== undefined ? (defaultContentId || null) : device.default_content_id,
      autoscale !== undefined ? (autoscale ? 1 : 0) : device.autoscale,
      device.id
    );

  const target = resolveActiveTarget(device.id);
  db.prepare('UPDATE devices SET current_playlist_id = ?, current_content_id = ? WHERE id = ?')
    .run(target.playlistId, target.contentId, device.id);

  const io = req.app.get('io');
  pushToDevice(io, device.id, 'playlist:update', target);
  pushDeviceStatus(io, device.id);

  res.json({ device: serializeDevice(db.prepare('SELECT * FROM devices WHERE id = ?').get(device.id)) });
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
  previewCache.remove(req.params.id);
  res.status(204).end();
});

router.post('/:id/command', requireAuth, requireAdmin, (req, res) => {
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const { type, payload } = req.body || {};
  const androidOnly = ['reboot', 'screen_off', 'screen_on', 'volume'];
  const universal = ['refresh', 'clear_cache'];
  if (![...androidOnly, ...universal].includes(type)) {
    return res.status(400).json({ error: `type must be one of ${[...androidOnly, ...universal].join(', ')}` });
  }
  if (androidOnly.includes(type) && device.kind !== 'android') {
    return res.status(400).json({ error: 'Remote power/volume commands are only available on Android TV players' });
  }

  const io = req.app.get('io');
  pushToDevice(io, device.id, 'command', { type, payload: payload || {} });
  res.status(202).json({ sent: true });
});

router.get('/me/playlist', requireDevice, (req, res) => {
  const playlist = getPlayableForTarget({
    playlistId: req.device.current_playlist_id,
    contentId: req.device.current_content_id,
  });
  res.json({ playlist, rotation: req.device.rotation, autoscale: !!req.device.autoscale });
});

router.get('/me/schedule-plan', requireDevice, (req, res) => {
  const schedules = getSchedulesForDevice(req.device.id).map((s) => {
    let daysOfWeek = [];
    try { daysOfWeek = JSON.parse(s.days_of_week); } catch { }
    return {
      id: s.id,
      daysOfWeek,
      startTime: s.start_time,
      endTime: s.end_time,
      timezone: s.timezone || 'UTC',
      priority: s.priority,
      updatedAt: s.updated_at,
      playable: getPlayableForTarget({ playlistId: s.playlist_id, contentId: s.content_id }),
    };
  });
  const defaultPlayable = getPlayableForTarget({
    playlistId: req.device.default_playlist_id,
    contentId: req.device.default_content_id,
  });
  res.json({
    schedules,
    default: defaultPlayable,
    rotation: req.device.rotation,
    autoscale: !!req.device.autoscale,
  });
});

module.exports = router;
