const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { tick } = require('../services/scheduler');

const router = express.Router();

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function serialize(row) {
  const deviceIds = db.prepare('SELECT device_id FROM schedule_devices WHERE schedule_id = ?')
    .all(row.id).map((r) => r.device_id);
  let days = [];
  try { days = JSON.parse(row.days_of_week); } catch { }
  return {
    id: row.id,
    name: row.name,
    playlistId: row.playlist_id,
    contentId: row.content_id,
    daysOfWeek: days,
    startTime: row.start_time,
    endTime: row.end_time,
    timezone: row.timezone,
    priority: row.priority,
    enabled: !!row.enabled,
    deviceIds,
  };
}

function validate(body) {
  const { name, playlistId, contentId, daysOfWeek, startTime, endTime, deviceIds } = body || {};
  if (!name) return 'name is required';
  if (!!playlistId === !!contentId) return 'choose exactly one of a playlist or a specific content item';
  if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0 || daysOfWeek.some((d) => d < 0 || d > 6)) {
    return 'daysOfWeek must be a non-empty array of integers 0-6 (0 = Sunday)';
  }
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) return 'startTime/endTime must be HH:MM (24h)';
  if (!Array.isArray(deviceIds) || deviceIds.length === 0) return 'deviceIds must be a non-empty array';
  return null;
}

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM schedules ORDER BY created_at').all();
  res.json({ schedules: rows.map(serialize) });
});

router.get('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Schedule not found' });
  res.json({ schedule: serialize(row) });
});

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error });
  const { name, playlistId, contentId, daysOfWeek, startTime, endTime, timezone, priority, enabled, deviceIds } = req.body;

  const id = uuidv4();
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO schedules (id, name, playlist_id, content_id, days_of_week, start_time,
                end_time, timezone, priority, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, name, playlistId || null, contentId || null, JSON.stringify(daysOfWeek), startTime, endTime,
        timezone || 'UTC', priority || 0, enabled === false ? 0 : 1);
    const link = db.prepare('INSERT INTO schedule_devices (schedule_id, device_id) VALUES (?, ?)');
    deviceIds.forEach((deviceId) => link.run(id, deviceId));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  tick(req.app.get('io'));
  res.status(201).json({ schedule: serialize(db.prepare('SELECT * FROM schedules WHERE id = ?').get(id)) });
});

router.patch('/:id', requireAuth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Schedule not found' });

  const merged = { ...serialize(row), ...req.body };
  const error = validate(merged);
  if (error) return res.status(400).json({ error });

  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE schedules SET name = ?, playlist_id = ?, content_id = ?, days_of_week = ?,
                start_time = ?, end_time = ?, timezone = ?, priority = ?, enabled = ?,
                updated_at = datetime('now') WHERE id = ?`)
      .run(merged.name, merged.playlistId || null, merged.contentId || null, JSON.stringify(merged.daysOfWeek),
        merged.startTime, merged.endTime, merged.timezone, merged.priority, merged.enabled ? 1 : 0, row.id);
    db.prepare('DELETE FROM schedule_devices WHERE schedule_id = ?').run(row.id);
    const link = db.prepare('INSERT INTO schedule_devices (schedule_id, device_id) VALUES (?, ?)');
    merged.deviceIds.forEach((deviceId) => link.run(row.id, deviceId));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  tick(req.app.get('io'));
  res.json({ schedule: serialize(db.prepare('SELECT * FROM schedules WHERE id = ?').get(row.id)) });
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
  tick(req.app.get('io'));
  res.status(204).end();
});

module.exports = router;
