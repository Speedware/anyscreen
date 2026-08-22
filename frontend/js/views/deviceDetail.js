import { api } from '../api.js';
import { ws } from '../ws.js';
import { navigate } from '../app.js';
import { escapeHtml, formatDateTime, formatSize } from '../utils.js';

export async function renderDeviceDetail(root, deviceId) {
  const [{ device }, { playlists }, { content }] = await Promise.all([
    api.get(`/devices/${deviceId}`),
    api.get('/playlists'),
    api.get('/content'),
  ]);
  const isAdmin = api.getUser()?.role === 'admin';
  const defaultTargetType = device.defaultContentId ? 'content' : 'playlist';

  root.innerHTML = `
    <div class="page-header">
      <h1 class="mt-0">${escapeHtml(device.name)}</h1>
      <div class="flex-row">
        ${isAdmin ? `
          <button class="warning" id="clear-cache-btn">Clear cache</button>
          <button id="refresh-btn">Refresh</button>
          <button class="success" id="repair-btn">Restore</button>
          <button class="danger" id="delete-btn">Remove</button>
        ` : ''}
        <a href="#/devices" class="nav-back" style="align-self:center">Back</a>
      </div>
    </div>
    <div id="status-line" class="card">${statusLineHtml(device)}</div>

    ${isAdmin ? `
    <div class="card">
      <h2 class="mt-0">Settings</h2>
      <div id="settings-error"></div>
      <form id="settings-form">
        <div class="field">
          <label>Name</label>
          <input name="name" value="${escapeHtml(device.name)}" required />
        </div>
        <div class="field">
          <label>Content rotation</label>
          <select name="rotation">
            ${[0, 90, 180, 270].map((deg) => `<option value="${deg}" ${device.rotation === deg ? 'selected' : ''}>${deg}°</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Play by default (shown when no schedule is active)</label>
          <select id="default-target-type">
            <option value="playlist" ${defaultTargetType === 'playlist' ? 'selected' : ''}>A playlist</option>
            <option value="content" ${defaultTargetType === 'content' ? 'selected' : ''}>A specific file</option>
          </select>
        </div>
        <div class="field" id="default-playlist-field" style="${defaultTargetType === 'content' ? 'display:none' : ''}">
          <label>Default playlist</label>
          <select name="defaultPlaylistId">
            <option value="">— None —</option>
            ${playlists.map((p) => `<option value="${p.id}" ${device.defaultPlaylistId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field" id="default-content-field" style="${defaultTargetType === 'playlist' ? 'display:none' : ''}">
          <label>Default file — plays on a loop until a playlist is chosen instead or a schedule takes over</label>
          <select name="defaultContentId">
            <option value="">— None —</option>
            ${content.map((c) => `<option value="${c.id}" ${device.defaultContentId === c.id ? 'selected' : ''}>${escapeHtml(c.name)} (${c.type})</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label><input type="checkbox" name="autoscale" style="width:auto" ${device.autoscale !== false ? 'checked' : ''} /> Autoscale (fill screen, no black bars)</label>
        </div>
        <div class="field">
          <label>Notes</label>
          <textarea name="notes" rows="3">${escapeHtml(device.notes)}</textarea>
        </div>
        <button type="submit">Save</button>
      </form>
    </div>
    ` : ''}

    ${device.kind === 'android' ? `
    <div class="card">
      <h2 class="mt-0">Remote control</h2>
      <div class="flex-row">
        <button class="secondary" data-cmd="screen_on">Screen on</button>
        <button class="secondary" data-cmd="screen_off">Screen off</button>
        <button class="danger" data-cmd="reboot">Reboot</button>
      </div>
    </div>
    <div class="card">
      <h2 class="mt-0">Device status</h2>
      <div class="telemetry-grid" id="telemetry">${telemetryHtml(device)}</div>
      <div id="cached-list">${cachedListHtml(device)}</div>
    </div>
    ` : ''}
  `;

  ws.on('device:status', (updated) => {
    if (updated.id !== deviceId) return;
    document.getElementById('status-line').innerHTML = statusLineHtml(updated);
    const telemetryEl = document.getElementById('telemetry');
    if (telemetryEl) telemetryEl.innerHTML = telemetryHtml(updated);
    const cachedListEl = document.getElementById('cached-list');
    if (cachedListEl) cachedListEl.innerHTML = cachedListHtml(updated);
  });

  const defaultTargetTypeSelect = document.getElementById('default-target-type');
  const defaultPlaylistField = document.getElementById('default-playlist-field');
  const defaultContentField = document.getElementById('default-content-field');
  defaultTargetTypeSelect?.addEventListener('change', () => {
    const isContent = defaultTargetTypeSelect.value === 'content';
    defaultPlaylistField.style.display = isContent ? 'none' : 'block';
    defaultContentField.style.display = isContent ? 'block' : 'none';
  });

  document.getElementById('settings-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const isContent = defaultTargetTypeSelect.value === 'content';
    const data = {
      name: form.name.value,
      rotation: form.rotation.value,
      notes: form.notes.value,
      autoscale: form.autoscale.checked,
      defaultPlaylistId: isContent ? null : form.defaultPlaylistId.value,
      defaultContentId: isContent ? form.defaultContentId.value : null,
    };
    try {
      await api.patch(`/devices/${deviceId}`, data);
      renderDeviceDetail(root, deviceId);
    } catch (err) {
      document.getElementById('settings-error').innerHTML = `<div class="error-banner">${err.message}</div>`;
    }
  });

  document.getElementById('delete-btn')?.addEventListener('click', async () => {
    if (!confirm('Remove this display? It will need to be paired again to reconnect.')) return;
    await api.del(`/devices/${deviceId}`);
    navigate('/devices');
  });

  document.getElementById('repair-btn')?.addEventListener('click', () => openRepairModal(root, deviceId));

  document.getElementById('refresh-btn')?.addEventListener('click', async (e) => {
    await api.post(`/devices/${deviceId}/command`, { type: 'refresh' });
  });

  document.getElementById('clear-cache-btn')?.addEventListener('click', async () => {
    if (!confirm('Clear this display\'s cached video/image files? It will re-download them as needed and lose offline playback until then.')) return;
    await api.post(`/devices/${deviceId}/command`, { type: 'clear_cache' });
  });

  root.querySelectorAll('[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api.post(`/devices/${deviceId}/command`, { type: btn.dataset.cmd });
    });
  });
}

function statusLineHtml(device) {
  const stalled = device.status === 'online' && device.isPlaying === false;
  return `
    <div class="flex-row">
      <span class="badge ${device.status}">${device.status}</span>
      ${stalled ? '<span class="badge stalled">stalled — content isn\'t advancing</span>' : ''}
      <span class="badge kind">${device.kind === 'android' ? 'Android TV' : 'Web player'}</span>
      <span class="text-dim">IP: ${escapeHtml(device.ipAddress) || '—'}</span>
      <span class="text-dim">Last seen: ${formatDateTime(device.lastSeenAt)}</span>
    </div>
    <p style="margin-bottom:0">Now playing: <strong>${escapeHtml(device.currentItemName) || '—'}</strong>${device.currentItemType ? ` <span class="text-dim">(${device.currentItemType})</span>` : ''}</p>
  `;
}

function openRepairModal(root, deviceId) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="mt-0">Restore display</h2>
      <p class="text-dim">If this display fell off (cleared storage, factory reset, replaced hardware), open the web player or Android app on it again, then enter the fresh code it shows below — its name, rotation, playlist and schedules stay put.</p>
      <div id="repair-error"></div>
      <form id="repair-form">
        <div class="field">
          <label>Pairing code</label>
          <input name="code" required maxlength="6" pattern="\\d{6}" placeholder="123456" autofocus />
        </div>
        <div class="modal-actions">
          <button type="button" class="secondary" id="cancel-repair">Cancel</button>
          <button type="submit" class="success">Restore</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#cancel-repair').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#repair-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      await api.post(`/devices/${deviceId}/repair`, data);
      overlay.remove();
      renderDeviceDetail(root, deviceId);
    } catch (err) {
      overlay.querySelector('#repair-error').innerHTML = `<div class="error-banner">${err.message}</div>`;
    }
  });
}

function wifiBarsHtml(level) {
  const heights = [4, 7, 10, 13];
  const bars = heights.map((h, i) => {
    const x = i * 5;
    const y = 13 - h;
    const filled = i < level;
    return `<rect x="${x}" y="${y}" width="3" height="${h}" rx="1" fill="${filled ? 'var(--text)' : 'var(--border)'}" />`;
  }).join('');
  return `<svg width="17" height="13" viewBox="0 0 17 13" style="vertical-align:middle;margin-left:4px">${bars}</svg>`;
}

function connectionTypeHtml(t) {
  if (t.connectionType === 'ethernet') return 'Ethernet';
  if (t.connectionType === 'wifi') {
    const level = typeof t.wifiSignalLevel === 'number' ? t.wifiSignalLevel : null;
    return `Wi-Fi${level !== null ? wifiBarsHtml(level) : ''}`;
  }
  return null;
}

function telemetryHtml(device) {
  const t = device.telemetry || {};
  const stat = (label, value) => `<div class="stat"><div class="label">${label}</div><div class="value">${value ?? '—'}</div></div>`;
  const cachedCount = Array.isArray(t.cachedItems) ? t.cachedItems.length : null;
  return [
    stat('Storage free', t.storageFreeGb !== undefined ? `${t.storageFreeGb} GB` : null),
    stat('RAM free', t.ramFreeMb !== undefined ? `${t.ramFreeMb} MB` : null),
    stat('Connection type', connectionTypeHtml(t)),
    stat('Cached for offline', cachedCount !== null ? `${cachedCount} file${cachedCount === 1 ? '' : 's'}` : null),
    stat('Cache used', typeof t.cachedBytesTotal === 'number' ? formatSize(t.cachedBytesTotal) : null),
  ].join('');
}

function cachedListHtml(device) {
  const items = device.telemetry?.cachedItems;
  if (!Array.isArray(items) || items.length === 0) return '';
  return `
    <div style="margin-top:16px">
      <div class="text-dim" style="font-size:12px;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:8px">Cached for offline playback</div>
      <ul class="playlist-items" style="margin:0">
        ${items.map((i) => `
          <li>
            <span class="item-type">${escapeHtml(i.type)}</span>
            <span class="item-name">${escapeHtml(i.name)}</span>
            <span class="text-dim">${typeof i.sizeBytes === 'number' ? formatSize(i.sizeBytes) : ''}</span>
          </li>
        `).join('')}
      </ul>
    </div>
  `;
}
