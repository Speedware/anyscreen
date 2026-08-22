const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { upload, contentDir, thumbnailDir } = require('../middleware/upload');
const { notifyPlaylistViewers, notifyContentViewers } = require('../ws/deviceNamespace');
const { processUpload } = require('../services/videoProcessing');

const router = express.Router();

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    source: row.source,
    url: row.source === 'upload' ? `/uploads/content/${row.location}` : row.location,
    durationSeconds: row.duration_seconds,
    muted: !!row.muted,
    thumbnailUrl: row.thumbnail_path ? `/uploads/thumbnails/${row.thumbnail_path}` : null,
    processingStatus: row.processing_status,
    optimized: !!row.optimized,
    createdAt: row.created_at,
  };
}

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM content ORDER BY created_at DESC').all();
  res.json({ content: rows.map(serialize) });
});

router.post('/upload', requireAuth, requireAdmin, upload.array('files', 15), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'At least one file is required' });
  const { name, muted } = req.body || {};
  const mutedFlag = muted === 'true' || muted === true ? 1 : 0;
  const useCustomName = req.files.length === 1 && name;
  const io = req.app.get('io');

  const created = req.files.map((file) => {
    const type = file.mimetype.startsWith('video/') ? 'video' : 'image';
    const id = uuidv4();
    db.prepare(`INSERT INTO content (id, name, type, source, location, duration_seconds, muted, processing_status)
                VALUES (?, ?, ?, 'upload', ?, NULL, ?, ?)`)
      .run(id, useCustomName ? name : file.originalname, type, file.filename,
        mutedFlag, type === 'video' ? 'processing' : 'ready');

    if (type === 'video') processUpload(io, id, path.join(contentDir, file.filename));
    return serialize(db.prepare('SELECT * FROM content WHERE id = ?').get(id));
  });

  res.status(201).json({ content: created });
});

router.post('/url', requireAuth, requireAdmin, (req, res) => {
  const { name, type, url, muted } = req.body || {};
  if (!name || !type || !url) return res.status(400).json({ error: 'name, type and url are required' });
  if (!['video', 'image', 'website'].includes(type)) {
    return res.status(400).json({ error: 'type must be video, image, or website' });
  }

  const id = uuidv4();
  db.prepare(`INSERT INTO content (id, name, type, source, location, duration_seconds, muted)
              VALUES (?, ?, ?, 'url', ?, NULL, ?)`)
    .run(id, name, type, url, muted ? 1 : 0);

  res.status(201).json({ content: serialize(db.prepare('SELECT * FROM content WHERE id = ?').get(id)) });
});

router.patch('/:id', requireAuth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM content WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Content not found' });

  const { name, durationSeconds, muted } = req.body || {};
  db.prepare('UPDATE content SET name = ?, duration_seconds = ?, muted = ? WHERE id = ?').run(
    name ?? row.name,
    durationSeconds !== undefined ? durationSeconds : row.duration_seconds,
    muted !== undefined ? (muted ? 1 : 0) : row.muted,
    row.id
  );

  const io = req.app.get('io');
  const affectedPlaylists = db.prepare('SELECT DISTINCT playlist_id FROM playlist_items WHERE content_id = ?').all(row.id);
  affectedPlaylists.forEach((p) => notifyPlaylistViewers(io, p.playlist_id));
  notifyContentViewers(io, row.id);

  res.json({ content: serialize(db.prepare('SELECT * FROM content WHERE id = ?').get(row.id)) });
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM content WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Content not found' });

  db.prepare('DELETE FROM content WHERE id = ?').run(row.id);

  if (row.source === 'upload') {
    const filePath = path.join(contentDir, row.location);
    fs.rm(filePath, { force: true }, () => {});
  }
  if (row.thumbnail_path) {
    fs.rm(path.join(thumbnailDir, row.thumbnail_path), { force: true }, () => {});
  }
  res.status(204).end();
});

module.exports = router;
