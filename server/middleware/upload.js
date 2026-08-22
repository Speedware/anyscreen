const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');

const contentDir = path.join(config.uploadsDir, 'content');
const thumbnailDir = path.join(config.uploadsDir, 'thumbnails');
fs.mkdirSync(contentDir, { recursive: true });
fs.mkdirSync(thumbnailDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, contentDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');

  const isVideo = file.mimetype.startsWith('video/');
  const isImage = file.mimetype.startsWith('image/');
  if (!isVideo && !isImage) return cb(new Error('Only video or image files can be uploaded'));
  cb(null, true);
}

const upload = multer({ storage, fileFilter, limits: { fileSize: config.maxFileSizeBytes } });

module.exports = { upload, contentDir, thumbnailDir };
