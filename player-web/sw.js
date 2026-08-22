
const CACHE_NAME = 'anyscreen-player-v2';
const warming = new Set();
const MAX_WARM_BYTES = 300 * 1024 * 1024;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)));
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(handleUpload(event));
  } else if (url.pathname === '/api/devices/me/playlist') {
    event.respondWith(networkFirst(request));
  }
});

async function handleUpload(event) {
  const request = event.request;
  const cache = await caches.open(CACHE_NAME);
  const rangeHeader = request.headers.get('range');
  const cached = await cache.match(request.url);

  if (cached) {
    return rangeHeader ? sliceRange(cached, rangeHeader) : cached.clone();
  }

  event.waitUntil(warmCache(request.url));
  return fetch(request);
}

function warmCache(url) {
  if (warming.has(url)) return Promise.resolve();
  warming.add(url);
  return (async () => {
    try {
      const head = await fetch(url, { method: 'HEAD' });
      const size = Number(head.headers.get('content-length') || 0);
      if (size > MAX_WARM_BYTES) return;

      const cache = await caches.open(CACHE_NAME);
      const response = await fetch(url);
      if (response.ok && response.status === 200) await cache.put(url, response);
    } catch (err) {
    } finally {
      warming.delete(url);
    }
  })();
}

async function sliceRange(response, rangeHeader) {
  const blob = await response.blob();
  const total = blob.size;
  const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
  if (!match) return new Response(blob, { headers: response.headers });

  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? Math.min(parseInt(match[2], 10), total - 1) : total - 1;
  const chunk = blob.slice(start, end + 1);

  const headers = new Headers(response.headers);
  headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
  headers.set('Content-Length', String(chunk.size));
  return new Response(chunk, { status: 206, statusText: 'Partial Content', headers });
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok && response.status !== 206) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}
