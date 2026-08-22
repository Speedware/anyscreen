import { api } from '../api.js';

export async function renderLogin(root, onSuccess) {
  const { setupNeeded } = await api.get('/auth/setup-needed');

  root.innerHTML = `
    <div class="auth-screen">
      <div class="auth-box card">
        <div class="brand">Any<span>screen</span></div>
        <div id="error"></div>
        <form id="auth-form">
          ${setupNeeded ? '<p class="text-dim">Create the first admin account to get started.</p>' : ''}
          <div class="field">
            <label>Email</label>
            <input type="email" name="email" required autofocus />
          </div>
          <div class="field">
            <label>Password</label>
            <input type="password" name="password" required minlength="8" />
          </div>
          <button type="submit" style="width:100%">${setupNeeded ? 'Create admin account' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  `;

  const form = document.getElementById('auth-form');
  const errorBox = document.getElementById('error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.innerHTML = '';
    const data = Object.fromEntries(new FormData(form));
    try {
      const result = await api.post(setupNeeded ? '/auth/register' : '/auth/login', data);
      api.setToken(result.token);
      api.setUser(result.user);
      onSuccess();
    } catch (err) {
      errorBox.innerHTML = `<div class="error-banner">${err.message}</div>`;
    }
  });
}
