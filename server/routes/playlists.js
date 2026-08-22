const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getPlaylistWithItems } = require('../services/resolvePlaylist');
const { notifyPlaylistViewers } = require('../ws/deviceNamespace');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM playlists ORDER BY created_at').all();
  res.json({ playlists: rows.map((r) => getPlaylistWithItems(r.id)) });
});

router.get('/:id', requireAuth, (req, res) => {
  const playlist = getPlaylistWithItems(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
  res.json({ playlist });
});

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = uuidv4();
  db.prepare('INSERT INTO playlists (id, name) VALUES (?, ?)').run(id, name);
  res.status(201).json({ playlist: getPlaylistWithItems(id) });
});

router.patch('/:id', requireAuth, requireAdmin, (req, res) => {
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
  const { name, muteAudio } = req.body || {};
  db.prepare("UPDATE playlists SET name = ?, mute_audio = ?, updated_at = datetime('now') WHERE id = ?")
    .run(name ?? playlist.name, muteAudio !== undefined ? (muteAudio ? 1 : 0) : playlist.mute_audio, playlist.id);
  notifyPlaylistViewers(req.app.get('io'), playlist.id);
  res.json({ playlist: getPlaylistWithItems(playlist.id) });
});

router.put('/:id/items', requireAuth, requireAdmin, (req, res) => {
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
  const { items } = req.body || {};
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' });

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(playlist.id);
    const insert = db.prepare(`INSERT INTO playlist_items (id, playlist_id, content_id, position, duration_override)
                                VALUES (?, ?, ?, ?, ?)`);
    items.forEach((item, index) => {
      insert.run(uuidv4(), playlist.id, item.contentId, index, item.durationOverride || null);
    });
    db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(playlist.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  notifyPlaylistViewers(req.app.get('io'), playlist.id);
  res.json({ playlist: getPlaylistWithItems(playlist.id) });
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM playlists WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
