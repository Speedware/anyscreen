import { api } from '../api.js';
import { escapeHtml } from '../utils.js';

const COMMON_TIMEZONES = [
  'Europe/Moscow',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Kyiv',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Almaty',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'UTC',
];

export async function renderSettings(root) {
  const settings = await api.get('/settings');
  const isAdmin = api.getUser()?.role === 'admin';

  root.innerHTML = `
    <div class="page-header"><h1 class="mt-0">Settings</h1></div>
    <div id="settings-error"></div>
    <div class="card">
      <div class="field">
        <label style="color:var(--text)">Default timezone</label>
        <input name="defaultTimezone" list="tz-options" value="${escapeHtml(settings.defaultTimezone)}" style="max-width:240px" ${isAdmin ? '' : 'disabled'} />
        <datalist id="tz-options">
          ${COMMON_TIMEZONES.map((tz) => `<option value="${tz}"></option>`).join('')}
        </datalist>
      </div>
      <div class="field" style="margin-bottom:0">
        <label style="color:var(--text)">Video content optimization</label>
        <label class="switch">
          <input type="checkbox" name="videoOptimizationEnabled" ${settings.videoOptimizationEnabled ? 'checked' : ''} ${isAdmin ? '' : 'disabled'} />
          <span class="switch-track"><span class="switch-thumb"></span></span>
        </label>
      </div>
    </div>
  `;

  document.querySelector('input[name=defaultTimezone]')?.addEventListener('change', async (e) => {
    try {
      await api.patch('/settings', { defaultTimezone: e.target.value });
      document.getElementById('settings-error').innerHTML = '';
    } catch (err) {
      document.getElementById('settings-error').innerHTML = `<div class="error-banner">${err.message}</div>`;
    }
  });

  document.querySelector('input[name=videoOptimizationEnabled]')?.addEventListener('change', async (e) => {
    try {
      await api.patch('/settings', { videoOptimizationEnabled: e.target.checked });
    } catch (err) {
      document.getElementById('settings-error').innerHTML = `<div class="error-banner">${err.message}</div>`;
    }
  });
}
