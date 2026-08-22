import { api } from '../api.js';
import { ws } from '../ws.js';
import { escapeHtml } from '../utils.js';

let allDevices = [];
let searchQuery = '';
let statusFilter = 'all';

function statusMeta(d) {
  if (d.status !== 'online') return { cls: 'offline', label: 'Offline' };
  if (d.isPlaying === false) return { cls: 'stalled', label: 'Stalled' };
  return { cls: 'online', label: 'Healthy' };
}

function statsHtml(devices) {
  const online = devices.filter((d) => d.status === 'online').length;
  return `
    <div class="stat-row">
      <div class="stat-card"><div class="label">Total</div><div class="value">${devices.length}</div></div>
      <div class="stat-card"><div class="label">Online</div><div class="value online">${online}</div></div>
      <div class="stat-card"><div class="label">Offline</div><div class="value offline">${devices.length - online}</div></div>
    </div>
  `;
}

function previewInnerHtml(preview) {
  if (preview?.type === 'image') return `<img src="${escapeHtml(preview.url)}" alt="" />`;
  if (preview?.type === 'site') return '<div class="site-preview"><span class="site-icon">🌐</span></div>';
  return '<div class="placeholder-brand">Anyscreen</div>';
}

function cardHtml(d, isAdmin) {
  const meta = statusMeta(d);
  return `
    <div class="screen-card" data-device-card="${d.id}" ${isAdmin ? 'draggable="true"' : ''}>
      <a href="#/devices/${d.id}" draggable="false">
        <div class="screen-preview" data-preview>
          ${previewInnerHtml(d.preview)}
          <span class="badge ${meta.cls} status-badge">${meta.label}</span>
        </div>
        <div class="screen-info">
          <div class="name">${escapeHtml(d.name)}</div>
        </div>
      </a>
    </div>
  `;
}

function filteredDevices() {
  return allDevices
    .filter((d) => {
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (searchQuery && !d.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

function gridHtml(isAdmin) {
  if (allDevices.length === 0) {
    return '<div class="empty-state">No displays paired yet. Open the web player or the Android app on a screen, then click "Add Display" and enter the code it shows.</div>';
  }
  const filtered = filteredDevices();
  if (filtered.length === 0) return '<div class="empty-state">No displays match your search.</div>';
  return `<div class="screen-grid" id="screen-grid">${filtered.map((d) => cardHtml(d, isAdmin)).join('')}</div>`;
}

function attachDragHandlers(isAdmin) {
  const grid = document.getElementById('screen-grid');
  if (!grid || !isAdmin) return;
  let draggedEl = null;

  grid.querySelectorAll('.screen-card[draggable="true"]').forEach((card) => {
    card.addEventListener('dragstart', () => {
      draggedEl = card;
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      draggedEl = null;
      persistOrder(grid);
    });
  });

  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedEl) return;
    const target = e.target.closest('.screen-card');
    if (!target || target === draggedEl) return;
    const rect = target.getBoundingClientRect();
    const before = e.clientX - rect.left < rect.width / 2;
    grid.insertBefore(draggedEl, before ? target : target.nextSibling);
  });
}

async function persistOrder(grid) {
  const order = [...grid.querySelectorAll('[data-device-card]')].map((el) => el.dataset.deviceCard);
  order.forEach((id, index) => {
    const dev = allDevices.find((d) => d.id === id);
    if (dev) dev.position = index;
  });
  try {
    await api.put('/devices/reorder', { order });
  } catch (err) {
  }
}

export async function renderDevices(root) {
  const { devices } = await api.get('/devices');
  allDevices = devices;
  const isAdmin = api.getUser()?.role === 'admin';

  root.innerHTML = `
    <div class="page-header">
      <h1 class="mt-0">Displays</h1>
      ${isAdmin ? '<button id="add-display">Add Display</button>' : ''}
    </div>
    <div id="stats">${statsHtml(allDevices)}</div>
    <div class="toolbar">
      <input type="search" id="search-input" placeholder="Search displays..." value="${escapeHtml(searchQuery)}" />
      <select id="status-filter">
        <option value="all">All Status</option>
        <option value="online" ${statusFilter === 'online' ? 'selected' : ''}>Online</option>
        <option value="offline" ${statusFilter === 'offline' ? 'selected' : ''}>Offline</option>
      </select>
    </div>
    <div id="grid-container">${gridHtml(isAdmin)}</div>
  `;
  document.getElementById('status-filter').value = statusFilter;
  attachDragHandlers(isAdmin);

  function refreshGrid() {
    document.getElementById('grid-container').innerHTML = gridHtml(isAdmin);
    attachDragHandlers(isAdmin);
  }

  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    refreshGrid();
  });
  document.getElementById('status-filter').addEventListener('change', (e) => {
    statusFilter = e.target.value;
    refreshGrid();
  });

  ws.on('device:status', (device) => {
    const idx = allDevices.findIndex((d) => d.id === device.id);
    if (idx >= 0) allDevices[idx] = { ...allDevices[idx], ...device };
    else allDevices.push(device);
    document.getElementById('stats').innerHTML = statsHtml(allDevices);
    refreshGrid();
  });

  ws.on('device:reorder', ({ order }) => {
    order.forEach((id, index) => {
      const dev = allDevices.find((d) => d.id === id);
      if (dev) dev.position = index;
    });
    refreshGrid();
  });

  ws.on('device:preview', ({ deviceId, preview }) => {
    const idx = allDevices.findIndex((d) => d.id === deviceId);
    if (idx >= 0) allDevices[idx] = { ...allDevices[idx], preview };
    const previewEl = document.querySelector(`[data-device-card="${deviceId}"] [data-preview]`);
    if (!previewEl) return;
    const badge = previewEl.querySelector('.status-badge');
    previewEl.innerHTML = `${previewInnerHtml(preview)}${badge ? badge.outerHTML : ''}`;
  });

  document.getElementById('add-display')?.addEventListener('click', () => openPairModal(root));
}

function openPairModal(root) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>Add Display</h2>
      <p class="text-dim">Open <code>/player</code> in a browser on the screen, or launch the Anyscreen Android app, then enter the pairing code it shows.</p>
      <div id="pair-error"></div>
      <form id="pair-form">
        <div class="field">
          <label>Pairing code</label>
          <input name="code" required maxlength="6" pattern="\\d{6}" placeholder="123456" autofocus />
        </div>
        <div class="field">
          <label>Display name (optional)</label>
          <input name="name" placeholder="Leave blank for Display 1, Display 2, ..." />
        </div>
        <div class="modal-actions">
          <button type="button" class="secondary" id="cancel-pair">Cancel</button>
          <button type="submit">Pair</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#cancel-pair').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#pair-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      await api.post('/devices/pair', data);
      overlay.remove();
      renderDevices(document.getElementById('main'));
    } catch (err) {
      overlay.querySelector('#pair-error').innerHTML = `<div class="error-banner">${err.message}</div>`;
    }
  });
}
