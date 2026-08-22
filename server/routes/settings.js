const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function getSettings() {
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  return { defaultTimezone: row.default_timezone, videoOptimizationEnabled: !!row.video_optimization_enabled };
}

router.get('/', requireAuth, (req, res) => {
  res.json(getSettings());
});

router.patch('/', requireAuth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  const { defaultTimezone, videoOptimizationEnabled } = req.body || {};

  const nextTimezone = defaultTimezone !== undefined ? defaultTimezone : row.default_timezone;
  if (!nextTimezone || typeof nextTimezone !== 'string') {
    return res.status(400).json({ error: 'defaultTimezone is required' });
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: nextTimezone });
  } catch {
    return res.status(400).json({ error: `"${nextTimezone}" is not a valid IANA timezone name` });
  }

  db.prepare('UPDATE settings SET default_timezone = ?, video_optimization_enabled = ? WHERE id = 1').run(
    nextTimezone,
    videoOptimizationEnabled !== undefined ? (videoOptimizationEnabled ? 1 : 0) : row.video_optimization_enabled
  );
  res.json(getSettings());
});

module.exports = router;
