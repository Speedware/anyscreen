const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const db = require('../db');

const FASTSTART_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov']);
const MAX_LONG_EDGE = 1920;
const MAX_SHORT_EDGE = 1080;

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

async function probe(filePath) {
  const stdout = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height',
    '-of', 'json',
    filePath,
  ]);
  const stream = JSON.parse(stdout).streams?.[0];
  if (!stream) throw new Error('no video stream found');
  return { codec: stream.codec_name, width: stream.width, height: stream.height };
}

function ensureFaststart(filePath) {
  if (!FASTSTART_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return Promise.resolve(false);
  const tempPath = `${filePath}.faststart.mp4`;
  return new Promise((resolve) => {
    execFile(
      'ffmpeg',
      ['-y', '-i', filePath, '-map', '0', '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', tempPath],
      (err) => {
        if (err) {
          fs.rm(tempPath, { force: true }, () => {});
          resolve(false);
          return;
        }
        fs.rename(tempPath, filePath, (renameErr) => resolve(!renameErr));
      }
    );
  });
}

function transcodeToFullHd(filePath) {
  const tempPath = `${filePath}.optimized.mp4`;
  return new Promise((resolve) => {
    execFile(
      'ffmpeg',
      [
        '-y', '-i', filePath,
        '-map', '0:v:0', '-map', '0:a?',
        '-vf', `scale='min(${MAX_LONG_EDGE},iw)':'min(${MAX_SHORT_EDGE},ih)':force_original_aspect_ratio=decrease`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        '-c:a', 'aac', '-b:a', '160k',
        '-movflags', '+faststart', '-f', 'mp4', tempPath,
      ],
      (err) => {
        if (err) {
          fs.rm(tempPath, { force: true }, () => {});
          resolve(false);
          return;
        }
        fs.rename(tempPath, filePath, (renameErr) => resolve(!renameErr));
      }
    );
  });
}

async function processUpload(io, contentId, filePath) {
  let optimized = false;
  try {
    const settings = db.prepare('SELECT video_optimization_enabled FROM settings WHERE id = 1').get();
    const optimizationEnabled = !!settings?.video_optimization_enabled;

    let needsTranscode = false;
    if (optimizationEnabled) {
      try {
        const { codec, width, height } = await probe(filePath);
        const longEdge = Math.max(width, height);
        const shortEdge = Math.min(width, height);
        needsTranscode = codec !== 'h264' || longEdge > MAX_LONG_EDGE || shortEdge > MAX_SHORT_EDGE;
      } catch (err) {
        needsTranscode = false;
      }
    }

    if (needsTranscode) {
      optimized = await transcodeToFullHd(filePath);
      if (!optimized) await ensureFaststart(filePath);
    } else {
      await ensureFaststart(filePath);
    }
  } catch (err) {
  } finally {
    db.prepare("UPDATE content SET processing_status = 'ready', optimized = ? WHERE id = ?").run(optimized ? 1 : 0, contentId);
    io.of('/dashboard').to('org').emit('content:status', { id: contentId, status: 'ready', optimized });
  }
}

module.exports = { processUpload, ensureFaststart };
