
const PAIRING_TTL_MS = 10 * 60 * 1000;
const codes = new Map();

function generateCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (codes.has(code));
  return code;
}

function register(socketId, kind) {
  const code = generateCode();
  const expiresAt = Date.now() + PAIRING_TTL_MS;
  codes.set(code, { socketId, kind, expiresAt });
  return { code, expiresAt };
}

function get(code) {
  const entry = codes.get(code);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    codes.delete(code);
    return null;
  }
  return entry;
}

function remove(code) {
  codes.delete(code);
}

function removeBySocketId(socketId) {
  for (const [code, entry] of codes.entries()) {
    if (entry.socketId === socketId) codes.delete(code);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of codes.entries()) {
    if (entry.expiresAt < now) codes.delete(code);
  }
}, 60 * 1000).unref();

module.exports = { register, get, remove, removeBySocketId };
