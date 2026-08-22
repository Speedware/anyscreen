(function () {
  const CREDS_KEY = 'anyscreen_device_creds';
  const CACHE_KEY = 'anyscreen_last_playlist';
  const HEARTBEAT_MS = 5000;
  const PREVIEW_MS = 5000;
  const VIDEO_STALL_GRACE_MS = 15000;

  const stage = document.getElementById('stage');
  const pairingOverlay = document.getElementById('pairing');
  const pairingCodeEl = document.getElementById('pairing-code');
  const pairingCountdownEl = document.getElementById('pairing-countdown');

  const slotA = document.createElement('div');
  slotA.className = 'slot';
  const slotB = document.createElement('div');
  slotB.className = 'slot';
  stage.appendChild(slotA);
  stage.appendChild(slotB);

  let creds = JSON.parse(localStorage.getItem(CREDS_KEY) || 'null');
  let socket = null;
  let playlist = null;
  let currentIndex = 0;
  let advanceTimer = null;
  let lastItem = null;
  let lastVideoTime = null;
  let heartbeatTimer = null;
  let previewTimer = null;
  let previewCanvas = null;
  let pairingCountdownTimer = null;
  let pairingExpiresAt = null;
  let sweepTimer = null;
  let activeSlot = null;

  function startSweep(boxes) {
    stopSweep();
    const ON_MS = 500;
    const GAP_MS = 220;
    const ALL_ON_MS = 700;
    const ALL_GAP_MS = 320;

    function step(index) {
      if (index < boxes.length) {
        boxes[index].classList.add('lit');
        sweepTimer = setTimeout(() => {
          boxes[index].classList.remove('lit');
          sweepTimer = setTimeout(() => step(index + 1), GAP_MS);
        }, ON_MS);
      } else {
        boxes.forEach((box) => box.classList.add('lit'));
        sweepTimer = setTimeout(() => {
          boxes.forEach((box) => box.classList.remove('lit'));
          sweepTimer = setTimeout(() => step(0), ALL_GAP_MS);
        }, ALL_ON_MS);
      }
    }

    step(0);
  }

  function stopSweep() {
    clearTimeout(sweepTimer);
    sweepTimer = null;
  }

  function showPairing(code) {
    pairingCodeEl.innerHTML = '';
    const digits = String(code).split('');
    const boxes = digits.map((digit, index) => {
      const box = document.createElement('div');
      box.className = 'code-digit';

      const value = document.createElement('span');
      value.className = 'code-digit-value';
      value.textContent = digit;
      value.style.animationDelay = `${index * 0.06}s`;
      box.appendChild(value);

      pairingCodeEl.appendChild(box);
      return box;
    });
    pairingOverlay.hidden = false;
    startSweep(boxes);
  }

  function hidePairing() {
    pairingOverlay.hidden = true;
    stopSweep();
  }

  function startPairingCountdown(expiresAt) {
    pairingExpiresAt = expiresAt;
    clearInterval(pairingCountdownTimer);
    updatePairingCountdown();
    pairingCountdownTimer = setInterval(updatePairingCountdown, 1000);
  }

  function stopPairingCountdown() {
    clearInterval(pairingCountdownTimer);
    pairingCountdownTimer = null;
    pairingExpiresAt = null;
  }

  function updatePairingCountdown() {
    const remainingMs = pairingExpiresAt - Date.now();
    if (remainingMs <= 0) {
      stopPairingCountdown();
      stopPairCheck();
      socket.disconnect();
      connect();
      return;
    }
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const ss = String(totalSeconds % 60).padStart(2, '0');
    if (pairingCountdownEl) pairingCountdownEl.textContent = `${mm}:${ss}`;
  }

  function setCreds(next) {
    creds = next;
    if (next) localStorage.setItem(CREDS_KEY, JSON.stringify(next));
    else localStorage.removeItem(CREDS_KEY);
  }

  function clearAdvanceTimer() {
    if (advanceTimer) clearTimeout(advanceTimer);
    advanceTimer = null;
  }

  function advance() {
    currentIndex += 1;
    playCurrent();
  }

  function activeSlotEl() {
    return activeSlot === 'a' ? slotA : activeSlot === 'b' ? slotB : null;
  }

  function nextSlotEl() {
    return activeSlot === 'a' ? slotB : slotA;
  }

  function stopVideosIn(el) {
    el.querySelectorAll('video').forEach((v) => {
      v.pause();
      v.removeAttribute('src');
      v.load();
    });
  }

  function activateSlot(target) {
    const previous = target === slotA ? slotB : slotA;
    target.classList.add('active');
    previous.classList.remove('active');
    activeSlot = target === slotA ? 'a' : 'b';
    setTimeout(() => {
      stopVideosIn(previous);
      previous.innerHTML = '';
    }, 450);
  }

  function playCurrent() {
    clearAdvanceTimer();
    const target = nextSlotEl();
    stopVideosIn(target);
    target.innerHTML = '';

    if (!playlist || !playlist.items || playlist.items.length === 0) {
      lastItem = null;
      const idle = document.createElement('div');
      idle.className = 'idle';
      idle.textContent = 'Waiting for content';
      target.appendChild(idle);
      activateSlot(target);
      sendHeartbeat();
      return;
    }

    const item = playlist.items[currentIndex % playlist.items.length];
    lastItem = item;
    lastVideoTime = null;

    if (item.type === 'video') {
      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = !!item.muted;
      video.playsInline = true;
      video.addEventListener('ended', advance);
      video.addEventListener('error', () => { advanceTimer = setTimeout(advance, 3000); });
      video.addEventListener('loadedmetadata', () => {
        const safetyMs = isFinite(video.duration) ? video.duration * 1000 + VIDEO_STALL_GRACE_MS : 10 * 60 * 1000;
        advanceTimer = setTimeout(advance, safetyMs);
      });

      let revealed = false;
      const reveal = () => {
        if (revealed) return;
        revealed = true;
        activateSlot(target);
      };
      video.addEventListener('canplay', reveal, { once: true });
      setTimeout(reveal, 4000);

      target.appendChild(video);
      video.src = item.url;

      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          video.muted = true;
          video.play().catch(() => {});
        });
      }
    } else if (item.type === 'image') {
      const img = document.createElement('img');
      let revealed = false;
      const reveal = () => {
        if (revealed) return;
        revealed = true;
        activateSlot(target);
      };
      img.addEventListener('load', reveal, { once: true });
      img.addEventListener('error', reveal, { once: true });
      setTimeout(reveal, 4000);
      target.appendChild(img);
      img.src = item.url;
      advanceTimer = setTimeout(advance, (item.durationSeconds || 10) * 1000);
    } else if (item.type === 'website') {
      const iframe = document.createElement('iframe');
      let revealed = false;
      const reveal = () => {
        if (revealed) return;
        revealed = true;
        activateSlot(target);
      };
      iframe.addEventListener('load', reveal, { once: true });
      setTimeout(reveal, 3000);
      target.appendChild(iframe);
      iframe.src = item.url;
      advanceTimer = setTimeout(advance, (item.durationSeconds || 30) * 1000);
    }

    sendHeartbeat();
  }

  async function fetchAndPlayPlaylist() {
    try {
      const res = await fetch('/api/devices/me/playlist', {
        headers: { Authorization: `Device ${creds.token}` },
      });
      if (!res.ok) throw new Error('playlist fetch failed');
      const data = await res.json();
      playlist = data.playlist;
      applyRotation(data.rotation);
      applyAutoscale(data.autoscale);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ playlist, rotation: data.rotation, autoscale: data.autoscale }));
    } catch (err) {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      playlist = cached ? cached.playlist : null;
      applyRotation(cached ? cached.rotation : 0);
      applyAutoscale(cached ? cached.autoscale : true);
    }
    currentIndex = 0;
    playCurrent();
  }

  function applyRotation(rotation) {
    const valid = [0, 90, 180, 270];
    stage.dataset.rotation = String(valid.includes(rotation) ? rotation : 0);
  }

  function applyAutoscale(autoscale) {
    stage.classList.toggle('autoscale', autoscale !== false);
  }

  function computePlaying() {
    const videoEl = activeSlotEl()?.querySelector('video');
    if (!videoEl || videoEl.ended) return true;
    if (lastVideoTime === null) {
      lastVideoTime = videoEl.currentTime;
      return true;
    }
    const stalled = videoEl.paused || videoEl.currentTime === lastVideoTime;
    lastVideoTime = videoEl.currentTime;
    return !stalled;
  }

  function sendHeartbeat() {
    if (!socket || !socket.connected) return;
    socket.emit('heartbeat', {
      itemName: lastItem ? lastItem.name : null,
      itemType: lastItem ? lastItem.type : null,
      playing: computePlaying(),
      telemetry: {},
    });
  }

  function startHeartbeat() {
    clearInterval(heartbeatTimer);
    sendHeartbeat();
    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);
  }

  function drawToCanvas(el) {
    if (!previewCanvas) previewCanvas = document.createElement('canvas');
    previewCanvas.width = 320;
    previewCanvas.height = 180;
    previewCanvas.getContext('2d').drawImage(el, 0, 0, previewCanvas.width, previewCanvas.height);
    return previewCanvas.toDataURL('image/jpeg', 0.5);
  }

  function capturePreview() {
    if (!socket || !socket.connected || !lastItem) return;

    if (lastItem.type === 'image') {
      const imgEl = activeSlotEl()?.querySelector('img');
      if (!imgEl || !imgEl.complete || imgEl.naturalWidth === 0) return;
      try {
        socket.emit('preview', { url: drawToCanvas(imgEl) });
      } catch (err) {
        socket.emit('preview', { url: imgEl.src });
      }
      return;
    }

    if (lastItem.type === 'video') {
      const videoEl = activeSlotEl()?.querySelector('video');
      if (!videoEl || videoEl.readyState < 2) return;
      try {
        socket.emit('preview', { url: drawToCanvas(videoEl) });
      } catch (err) {
      }
      return;
    }

    if (lastItem.type === 'website') {
      let domain = lastItem.url;
      try { domain = new URL(lastItem.url).hostname; } catch { }
      socket.emit('preview', { site: domain });
    }
  }

  function startPreviewCapture() {
    clearInterval(previewTimer);
    capturePreview();
    previewTimer = setInterval(capturePreview, PREVIEW_MS);
  }

  let pairCheckTimer = null;

  function startPairCheck() {
    clearInterval(pairCheckTimer);
    pairCheckTimer = setInterval(() => {
      if (socket && socket.connected) socket.emit('pair:check');
    }, 30000);
  }

  function stopPairCheck() {
    clearInterval(pairCheckTimer);
    pairCheckTimer = null;
  }

  function connect() {
    const auth = creds ? { deviceId: creds.deviceId, token: creds.token } : { kind: 'web' };
    socket = io('/device', { auth });

    socket.on('pair:code', ({ code, expiresAt }) => {
      showPairing(code);
      startPairCheck();
      startPairingCountdown(expiresAt);
    });

    socket.on('pair:expired', () => {
      stopPairCheck();
      stopPairingCountdown();
      socket.disconnect();
      connect();
    });

    socket.on('pair:success', ({ deviceId, token }) => {
      stopPairCheck();
      stopPairingCountdown();
      setCreds({ deviceId, token });
      hidePairing();
      socket.disconnect();
      connect();
    });

    socket.on('authenticated', () => {
      hidePairing();
      fetchAndPlayPlaylist();
      startHeartbeat();
      startPreviewCapture();
    });

    socket.on('auth:error', () => {
      setCreds(null);
      socket.disconnect();
      connect();
    });

    socket.on('playlist:update', fetchAndPlayPlaylist);

    socket.on('command', ({ type }) => {
      if (type === 'refresh') {
        location.reload();
      } else if (type === 'clear_cache') {
        caches.keys()
          .then((names) => Promise.all(names.map((name) => caches.delete(name))))
          .finally(() => location.reload());
      }
    });
  }

  connect();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/player/sw.js', { scope: '/' }).catch(() => {});
  }
})();
