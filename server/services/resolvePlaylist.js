const db = require('../db');

const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function zonedDayAndTime(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday').value;
  const hour = parts.find((p) => p.type === 'hour').value;
  const minute = parts.find((p) => p.type === 'minute').value;
  return { day: DAY_INDEX[weekday], time: `${hour}:${minute}` };
}

function inWindow(current, start, end) {
  if (start === end) return false;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

function getSchedulesForDevice(deviceId) {
  return db.prepare(`
    SELECT s.* FROM schedules s
    JOIN schedule_devices sd ON sd.schedule_id = s.id
    WHERE sd.device_id = ? AND s.enabled = 1
  `).all(deviceId);
}

function findActiveSchedule(deviceId, now = new Date()) {
  const schedules = getSchedulesForDevice(deviceId);

  let best = null;
  for (const schedule of schedules) {
    const { day, time } = zonedDayAndTime(now, schedule.timezone || 'UTC');
    let days;
    try { days = JSON.parse(schedule.days_of_week); } catch { days = []; }
    if (!days.includes(day)) continue;
    if (!inWindow(time, schedule.start_time, schedule.end_time)) continue;

    if (!best) { best = schedule; continue; }
    if (schedule.priority > best.priority) { best = schedule; continue; }
    if (schedule.priority === best.priority && schedule.updated_at > best.updated_at) best = schedule;
  }
  return best;
}

function resolveActiveTarget(deviceId, now = new Date()) {
  const schedule = findActiveSchedule(deviceId, now);
  if (schedule) return { playlistId: schedule.playlist_id, contentId: schedule.content_id };
  const device = db.prepare('SELECT default_playlist_id, default_content_id FROM devices WHERE id = ?').get(deviceId);
  if (!device) return { playlistId: null, contentId: null };
  return { playlistId: device.default_playlist_id, contentId: device.default_content_id };
}

function getContentAsPlayable(contentId) {
  if (!contentId) return null;
  const c = db.prepare('SELECT * FROM content WHERE id = ?').get(contentId);
  if (!c) return null;
  return {
    id: null,
    name: c.name,
    items: [{
      itemId: c.id,
      contentId: c.id,
      name: c.name,
      type: c.type,
      url: c.source === 'upload' ? `/uploads/content/${c.location}` : c.location,
      durationSeconds: c.duration_seconds ?? null,
      muted: !!c.muted,
    }],
  };
}

function getPlayableForTarget(target) {
  if (target.playlistId) return getPlaylistWithItems(target.playlistId);
  if (target.contentId) return getContentAsPlayable(target.contentId);
  return null;
}

function getPlaylistWithItems(playlistId) {
  if (!playlistId) return null;
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(playlistId);
  if (!playlist) return null;
  const items = db.prepare(`
    SELECT pi.id AS item_id, pi.position, pi.duration_override,
           c.id AS content_id, c.name, c.type, c.source, c.location, c.duration_seconds, c.muted
    FROM playlist_items pi
    JOIN content c ON c.id = pi.content_id
    WHERE pi.playlist_id = ?
    ORDER BY pi.position ASC
  `).all(playlistId);
  return {
    id: playlist.id,
    name: playlist.name,
    muteAudio: !!playlist.mute_audio,
    items: items.map((i) => ({
      itemId: i.item_id,
      contentId: i.content_id,
      name: i.name,
      type: i.type,
      url: i.source === 'upload' ? `/uploads/content/${i.location}` : i.location,
      durationSeconds: i.duration_override ?? i.duration_seconds ?? null,
      muted: i.type === 'video' ? (!!i.muted || !!playlist.mute_audio) : !!i.muted,
    })),
  };
}

module.exports = {
  getSchedulesForDevice,
  findActiveSchedule,
  resolveActiveTarget,
  getPlaylistWithItems,
  getContentAsPlayable,
  getPlayableForTarget,
};
