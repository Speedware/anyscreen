import { api } from '../api.js';
import { escapeHtml } from '../utils.js';

export async function renderUsers(root) {
  const { users } = await api.get('/auth/users');
  const me = api.getUser();

  root.innerHTML = `
    <div class="page-header">
      <h1 class="mt-0">Users</h1>
      <button id="add-user">Add user</button>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Email</th><th>Role</th><th></th></tr></thead>
        <tbody>
          ${users.map((u) => `
            <tr>
              <td>${escapeHtml(u.email)}</td>
              <td><span class="badge kind">${u.role}</span></td>
              <td>${u.id !== me.id ? `<button class="danger" data-delete="${u.id}">Delete</button>` : '<span class="text-dim">(you)</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('add-user').addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2 class="mt-0">Add user</h2>
        <div id="form-error"></div>
        <form id="user-form">
          <div class="field"><label>Email</label><input name="email" type="email" required /></div>
          <div class="field"><label>Password</label><input name="password" type="password" minlength="8" required /></div>
          <div class="field">
            <label>Role</label>
            <select name="role">
              <option value="viewer">Viewer (read-only)</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div class="modal-actions">
            <button type="button" class="secondary" id="cancel">Cancel</button>
            <button type="submit">Add</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#user-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      try {
        await api.post('/auth/users', data);
        overlay.remove();
        renderUsers(root);
      } catch (err) {
        overlay.querySelector('#form-error').innerHTML = `<div class="error-banner">${err.message}</div>`;
      }
    });
  });

  root.querySelectorAll('[data-delete]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this user?')) return;
      await api.del(`/auth/users/${btn.dataset.delete}`);
      renderUsers(root);
    }));
}
