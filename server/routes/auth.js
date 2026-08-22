const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const config = require('../config');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: '30d' });
}

function userCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

router.get('/setup-needed', (req, res) => {
  res.json({ setupNeeded: userCount() === 0 });
});

router.post('/register', (req, res) => {
  if (userCount() > 0) {
    return res.status(403).json({ error: 'Registration is closed. Ask an admin to invite you.' });
  }
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Email and a password of at least 8 characters are required' });
  }
  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(id, email.toLowerCase().trim(), passwordHash, 'admin');
  const user = { id, email, role: 'admin' };
  res.status(201).json({ token: signToken(user), user });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase().trim());
  if (!row || !bcrypt.compareSync(password || '', row.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const user = { id: row.id, email: row.email, role: row.role };
  res.json({ token: signToken(user), user });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, email, role, created_at FROM users ORDER BY created_at').all();
  res.json({ users });
});

router.post('/users', requireAuth, requireAdmin, (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Email and a password of at least 8 characters are required' });
  }
  if (role && !['admin', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin or viewer' });
  }
  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);
  try {
    db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(id, email.toLowerCase().trim(), passwordHash, role || 'viewer');
  } catch (err) {
    return res.status(409).json({ error: 'A user with that email already exists' });
  }
  res.status(201).json({ user: { id, email, role: role || 'viewer' } });
});

router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "You can't delete your own account" });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
