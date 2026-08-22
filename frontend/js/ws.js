import { api } from './api.js';

let socket = null;
const listeners = new Map();

function ensureConnected() {
  const token = api.getToken();
  if (!token) return null;

  if (socket && socket.connected) return socket;
  if (socket) socket.disconnect();

  socket = io('/dashboard', { auth: { token } });
  for (const [event, callbacks] of listeners.entries()) {
    for (const cb of callbacks) socket.on(event, cb);
  }
  return socket;
}

function on(event, callback) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(callback);
  if (socket) socket.on(event, callback);
}

function off(event, callback) {
  listeners.get(event)?.delete(callback);
  if (socket) socket.off(event, callback);
}

function disconnect() {
  if (socket) socket.disconnect();
  socket = null;
  listeners.clear();
}

function clearListeners() {
  if (socket) {
    for (const [event, callbacks] of listeners.entries()) {
      for (const cb of callbacks) socket.off(event, cb);
    }
  }
  listeners.clear();
}

export const ws = { ensureConnected, on, off, disconnect, clearListeners };
