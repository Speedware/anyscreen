const previews = new Map();

function set(deviceId, preview) {
  previews.set(deviceId, { preview, updatedAt: Date.now() });
}

function get(deviceId) {
  return previews.get(deviceId)?.preview || null;
}

function remove(deviceId) {
  previews.delete(deviceId);
}

module.exports = { set, get, remove };
