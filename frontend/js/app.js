import { api } from './api.js';
import { ws } from './ws.js';
import { escapeHtml } from './utils.js';
import { renderLogin } from './views/login.js';
import { renderDevices } from './views/devices.js';
import { renderDeviceDetail } from './views/deviceDetail.js';
import { renderContent } from './views/content.js';
import { renderPlaylists } from './views/playlists.js';
import { renderSchedules } from './views/schedules.js';
import { renderUsers } from './views/users.js';
import { renderSettings } from './views/settings.js';

const NAV_ITEMS = [
  { path: '/devices', label: 'Displays' },
  { path: '/content', label: 'Content' },
  { path: '/playlists', label: 'Playlists' },
  { path: '/schedules', label: 'Schedules' },
  { path: '/users', label: 'Users', adminOnly: true },
  { path: '/settings', label: 'Settings', adminOnly: true },
];

const app = document.getElementById('app');

function parseHash() {
  const hash = location.hash.replace(/^#/, '') || '/devices';
  const [path, ...rest] = hash.split('/').filter(Boolean);
  return { path: `/${path || 'devices'}`, params: rest };
}

function layoutShell(activePath) {
  const user = api.getUser();
  const nav = NAV_ITEMS.filter((item) => !item.adminOnly || user?.role === 'admin')
    .map((item) => `<a href="#${item.path}" class="${activePath === item.path ? 'active' : ''}">${item.label}</a>`)
    .join('');

  app.innerHTML = `
    <div class="layout">
      <div class="sidebar">
        <div class="brand">Any<span>screen</span></div>
        <nav>${nav}</nav>
        <div class="user-box">
          <span class="avatar-circle">${escapeHtml((user?.role ?? '?').charAt(0).toUpperCase())}</span>
          <div class="user-text">
            <div class="user-role">${escapeHtml(user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : '')}</div>
            <div class="user-email">${escapeHtml(user?.email ?? '')}</div>
          </div>
          <button class="icon-btn" id="logout-link" title="Sign out" aria-label="Sign out">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </div>
      </div>
      <div class="main" id="main"></div>
    </div>
  `;
  document.getElementById('logout-link').addEventListener('click', (e) => {
    e.preventDefault();
    api.setToken(null);
    api.setUser(null);
    ws.disconnect();
    navigate('/login');
  });
  return document.getElementById('main');
}

async function route() {
  const { path, params } = parseHash();

  if (path === '/login') {
    app.innerHTML = '';
    renderLogin(app, () => navigate('/devices'));
    return;
  }

  if (!api.getToken()) {
    navigate('/login');
    return;
  }

  if (!api.getUser()) {
    try {
      const { user } = await api.get('/auth/me');
      api.setUser(user);
    } catch {
      navigate('/login');
      return;
    }
  }

  ws.ensureConnected();
  ws.clearListeners();
  const main = layoutShell(path);

  try {
    if (path === '/devices' && params.length === 0) return renderDevices(main);
    if (path === '/devices' && params.length === 1) return renderDeviceDetail(main, params[0]);
    if (path === '/content') return renderContent(main);
    if (path === '/playlists') return renderPlaylists(main, params[0]);
    if (path === '/schedules') return renderSchedules(main);
    if (path === '/users') return renderUsers(main);
    if (path === '/settings') return renderSettings(main);
    main.innerHTML = '<div class="empty-state">Page not found.</div>';
  } catch (err) {
    main.innerHTML = `<div class="error-banner">${err.message}</div>`;
  }
}

export function navigate(path) {
  location.hash = `#${path}`;
}

window.addEventListener('hashchange', route);
route();
