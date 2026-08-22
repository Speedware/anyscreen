import { api } from '../api.js';
import { escapeHtml, formatDays } from '../utils.js';

const DAY_OPTIONS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
];

export async function renderSchedules(root) {
  const [{ schedules }, { playlists }, { content }, { devices }, settings] = await Promise.all([
    api.get('/schedules'),
    api.get('/playlists'),
    api.get('/content'),
    api.get('/devices'),
    api.get('/settings'),
  ]);
  const isAdmin = api.getUser()?.role === 'admin';
  const targetName = (s) => {
    if (s.playlistId) return playlists.find((p) => p.id === s.playlistId)?.name ?? '(deleted playlist)';
    return content.find((c) => c.id === s.contentId)?.name ?? '(deleted content)';
  };
  const deviceNames = (ids) => ids.map((id) => devices.find((d) => d.id === id)?.name).filter(Boolean).join(', ') || '—';

  root.innerHTML = `
    <div class="page-header">
      <h1 class="mt-0">Schedules</h1>
      ${isAdmin ? '<button id="create-schedule">Create schedule</button>' : ''}
    </div>
    <div class="card">
      ${schedules.length === 0 ? '<div class="empty-state">No schedules yet — displays fall back to their default playlist.</div>' : `
      <table>
        <thead><tr><th>Name</th><th>Plays</th><th>Days</th><th>Time</th><th>Displays</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${schedules.map((s) => `
            <tr>
              <td>${escapeHtml(s.name)}</td>
              <td>${escapeHtml(targetName(s))} <span class="text-dim">(${s.playlistId ? 'playlist' : 'file'})</span></td>
              <td>${formatDays(s.daysOfWeek)}</td>
              <td>${s.startTime}–${s.endTime} <span class="text-dim">(${escapeHtml(s.timezone)})</span></td>
              <td>${escapeHtml(deviceNames(s.deviceIds))}</td>
              <td><span class="badge ${s.enabled ? 'online' : 'offline'}">${s.enabled ? 'enabled' : 'disabled'}</span></td>
              <td>${isAdmin ? `
                <button class="secondary" data-edit="${s.id}">Edit</button>
                <button class="danger" data-delete="${s.id}">Delete</button>
              ` : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`}
    </div>
  `;

  document.getElementById('create-schedule')?.addEventListener('click', () => openForm(root, null, playlists, content, devices, settings));

  root.querySelectorAll('[data-edit]').forEach((btn) =>
    btn.addEventListener('click', () => openForm(root, schedules.find((s) => s.id === btn.dataset.edit), playlists, content, devices, settings)));

  root.querySelectorAll('[data-delete]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this schedule?')) return;
      await api.del(`/schedules/${btn.dataset.delete}`);
      renderSchedules(root);
    }));
}

function openForm(root, schedule, playlists, content, devices, settings) {
  const isEdit = !!schedule;
  const selectedDays = new Set(schedule?.daysOfWeek ?? []);
  const selectedDevices = new Set(schedule?.deviceIds ?? []);
  const suggestedTz = settings?.defaultTimezone || 'UTC';
  const targetType = schedule?.contentId ? 'content' : 'playlist';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="mt-0">${isEdit ? 'Edit schedule' : 'Create schedule'}</h2>
      <div id="form-error"></div>
      <form id="schedule-form">
        <div class="field">
          <label>Name</label>
          <input name="name" value="${escapeHtml(schedule?.name ?? '')}" required />
        </div>
        <div class="field">
          <label>Play</label>
          <select name="targetType" id="target-type">
            <option value="playlist" ${targetType === 'playlist' ? 'selected' : ''}>A playlist</option>
            <option value="content" ${targetType === 'content' ? 'selected' : ''}>A specific file</option>
          </select>
        </div>
        <div class="field" id="playlist-field" style="${targetType === 'content' ? 'display:none' : ''}">
          <label>Playlist to play</label>
          <select name="playlistId">
            ${playlists.map((p) => `<option value="${p.id}" ${schedule?.playlistId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field" id="content-field" style="${targetType === 'playlist' ? 'display:none' : ''}">
          <label>File to play</label>
          <select name="contentId">
            ${content.map((c) => `<option value="${c.id}" ${schedule?.contentId === c.id ? 'selected' : ''}>${escapeHtml(c.name)} (${c.type})</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Days</label>
          <div class="day-picker">
            ${DAY_OPTIONS.map((opt) => `
              <label><input type="checkbox" name="day" value="${opt.value}" ${selectedDays.has(opt.value) ? 'checked' : ''}/> ${opt.label}</label>
            `).join('')}
          </div>
        </div>
        <div class="field flex-row">
          <div style="flex:1">
            <label>Start time</label>
            <input name="startTime" type="time" value="${schedule?.startTime ?? '09:00'}" required style="width:100%" />
          </div>
          <div style="flex:1">
            <label>End time</label>
            <input name="endTime" type="time" value="${schedule?.endTime ?? '17:00'}" required style="width:100%" />
          </div>
        </div>
        <div class="field">
          <label>Priority — higher wins if two schedules overlap for the same display</label>
          <input name="priority" type="number" value="${schedule?.priority ?? 0}" />
        </div>
        <div class="field">
          <label>Displays</label>
          <div class="device-select-list">
            ${devices.length === 0 ? '<span class="text-dim">No displays paired yet.</span>' : devices.map((d) => `
              <label><input type="checkbox" name="device" value="${d.id}" ${selectedDevices.has(d.id) ? 'checked' : ''}/> ${escapeHtml(d.name)}</label>
            `).join('')}
          </div>
        </div>
        <div class="field">
          <label><input type="checkbox" name="enabled" style="width:auto" ${schedule?.enabled !== false ? 'checked' : ''}/> Enabled</label>
        </div>
        <div class="modal-actions">
          <button type="button" class="secondary" id="cancel">Cancel</button>
          <button type="submit">${isEdit ? 'Save' : 'Create'}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#cancel').addEventListener('click', () => overlay.remove());

  const targetTypeSelect = overlay.querySelector('#target-type');
  const playlistField = overlay.querySelector('#playlist-field');
  const contentField = overlay.querySelector('#content-field');
  targetTypeSelect.addEventListener('change', () => {
    const isContent = targetTypeSelect.value === 'content';
    playlistField.style.display = isContent ? 'none' : 'block';
    contentField.style.display = isContent ? 'block' : 'none';
  });

  overlay.querySelector('#schedule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const isContent = form.targetType.value === 'content';
    const payload = {
      name: form.name.value,
      playlistId: isContent ? null : form.playlistId.value,
      contentId: isContent ? form.contentId.value : null,
      daysOfWeek: [...form.querySelectorAll('input[name=day]:checked')].map((el) => Number(el.value)),
      startTime: form.startTime.value,
      endTime: form.endTime.value,
      timezone: schedule?.timezone ?? suggestedTz,
      priority: Number(form.priority.value) || 0,
      deviceIds: [...form.querySelectorAll('input[name=device]:checked')].map((el) => el.value),
      enabled: form.enabled.checked,
    };
    try {
      if (isEdit) await api.patch(`/schedules/${schedule.id}`, payload);
      else await api.post('/schedules', payload);
      overlay.remove();
      renderSchedules(document.getElementById('main'));
    } catch (err) {
      overlay.querySelector('#form-error').innerHTML = `<div class="error-banner">${err.message}</div>`;
    }
  });
}
