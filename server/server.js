const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const config = require('./config');
require('./db');

const authRoutes = require('./routes/auth');
const deviceRoutes = require('./routes/devices');
const contentRoutes = require('./routes/content');
const playlistRoutes = require('./routes/playlists');
const scheduleRoutes = require('./routes/schedules');
const settingsRoutes = require('./routes/settings');

const deviceNamespace = require('./ws/deviceNamespace');
const dashboardNamespace = require('./ws/dashboardNamespace');
const scheduler = require('./services/scheduler');
const heartbeat = require('./services/heartbeat');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });
app.set('io', io);

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/settings', settingsRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use('/uploads', express.static(config.uploadsDir));

app.get('/download/apk', (req, res) => {
  const apkPath = path.join(__dirname, 'Anyscreen.apk');
  if (!fs.existsSync(apkPath)) {
    return res.status(404).json({ error: 'No APK has been published on this server yet. See android/README.md to build one.' });
  }
  res.download(apkPath, 'Anyscreen.apk');
});

app.get('/player/sw.js', (req, res) => {
  res.set('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, '..', 'player-web', 'sw.js'));
});
app.use('/player', express.static(path.join(__dirname, '..', 'player-web')));

app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File exceeds the ${Math.round(config.maxFileSizeBytes / (1024 * 1024))}MB upload limit` });
  }
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(413).json({ error: 'Too many files in one upload (max 15)' });
  }
  res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error' });
});

deviceNamespace.setup(io);
dashboardNamespace.setup(io);
scheduler.start(io);
heartbeat.start(io);

server.listen(config.port, () => {
  console.log(`Anyscreen server listening on http://localhost:${config.port}`);
  console.log(`  Dashboard:  http://localhost:${config.port}/`);
  console.log(`  Web player: http://localhost:${config.port}/player`);
});
