const db = require('../db');

function requireDevice(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Device ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing device token' });

  const device = db.prepare('SELECT * FROM devices WHERE token = ?').get(token);
  if (!device) return res.status(401).json({ error: 'Invalid device token' });

  req.device = device;
  next();
}

module.exports = { requireDevice };
