import { api } from '../api.js';
import { navigate } from '../app.js';
import { escapeHtml } from '../utils.js';

export async function renderPlaylists(root, playlistId) {
  const isAdmin = api.getUser()?.role === 'admin';
  if (playlistId) return renderEditor(root, playlistId, isAdmin);

  const { playlists } = await api.get('/playlists');
  root.innerHTML = `
    <div class="page-header">
      <h1 class="mt-0">Playlists</h1>
      ${isAdmin ? '<button id="create-playlist">Create playlist</button>' : ''}
    </div>
    <div class="card">
      ${playlists.length === 0 ? '<div class="empty-state">No playlists yet.</div>' : `
      <table>
        <thead><tr><th>Name</th><th>Items</th><th></th></tr></thead>
        <tbody>
          ${playlists.map((p) => `
            <tr class="clickable-row" data-playlist-row="${p.id}">
              <td>${escapeHtml(p.name)}</td>
              <td>${p.items.length}</td>
              <td style="text-align:right;white-space:nowrap">${isAdmin ? `<button class="danger" data-delete="${p.id}">Delete</button>` : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`}
    </div>
  `;

  document.getElementById('create-playlist')?.addEventListener('click', async () => {
    const name = prompt('Playlist name');
    if (!name) return;
    const { playlist } = await api.post('/playlists', { name });
    navigate(`/playlists/${playlist.id}`);
  });

  root.querySelectorAll('[data-playlist-row]').forEach((row) =>
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-delete]')) return;
      navigate(`/playlists/${row.dataset.playlistRow}`);
    }));

  root.querySelectorAll('[data-delete]').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this playlist? Any schedules using it will also be removed.')) return;
      await api.del(`/playlists/${btn.dataset.delete}`);
      renderPlaylists(root);
    }));
}

async function renderEditor(root, playlistId, isAdmin) {
  const [{ playlist }, { content }] = await Promise.all([
    api.get(`/playlists/${playlistId}`),
    api.get('/content'),
  ]);

  const availableContent = content.filter((c) => !playlist.items.some((i) => i.contentId === c.id));

  root.innerHTML = `
    <div class="page-header">
      <h1 class="mt-0">${escapeHtml(playlist.name)}</h1>
      <a href="#/playlists" class="nav-back" style="align-self:center">Back</a>
    </div>

    <div class="card">
      <label class="flex-row" style="cursor:pointer;margin-bottom:0">
        <input type="checkbox" id="mute-audio-toggle" style="width:auto" ${playlist.muteAudio ? 'checked' : ''} ${isAdmin ? '' : 'disabled'} />
        <span>Mute audio for all videos in this playlist</span>
      </label>
    </div>

    <div class="card">
      <h2 class="mt-0">Items — plays in this order, on a loop</h2>
      <p class="text-dim">Videos always play in full; set how long each image or website shows before moving on.</p>
      ${playlist.items.length === 0 ? '<div class="empty-state">No items yet. Add content below.</div>' : `
      <ul class="playlist-items" id="items-list">
        ${playlist.items.map((item, index) => `
          <li data-item-id="${item.itemId}" data-content-id="${item.contentId}">
            <span class="item-type">${item.type}</span>
            <span class="item-name">${escapeHtml(item.name)}</span>
            ${item.type === 'video'
              ? '<span class="text-dim">full length</span>'
              : `<input type="number" min="1" data-duration value="${item.durationSeconds ?? (item.type === 'website' ? 30 : 10)}" style="width:70px" ${isAdmin ? '' : 'disabled'} /><span class="text-dim">sec</span>`}
            ${isAdmin ? `
            <button class="secondary" data-move="up" ${index === 0 ? 'disabled' : ''}>&uarr;</button>
            <button class="secondary" data-move="down" ${index === playlist.items.length - 1 ? 'disabled' : ''}>&darr;</button>
            <button class="danger" data-remove>Remove</button>
            ` : ''}
          </li>
        `).join('')}
      </ul>`}
    </div>

    ${isAdmin ? `
    <div class="card">
      <h2 class="mt-0">Add content</h2>
      ${availableContent.length === 0 ? '<div class="empty-state">All content items are already in this playlist.</div>' : `
      <div class="flex-row">
        <select id="content-picker" style="flex:1">
          ${availableContent.map((c) => `<option value="${c.id}">${escapeHtml(c.name)} (${c.type})</option>`).join('')}
        </select>
        <button id="add-item">Add to playlist</button>
      </div>`}
    </div>` : ''}
  `;

  document.getElementById('mute-audio-toggle')?.addEventListener('change', async (e) => {
    await api.patch(`/playlists/${playlistId}`, { muteAudio: e.target.checked });
    renderEditor(root, playlistId, isAdmin);
  });

  async function saveItems(items) {
    const { playlist: updated } = await api.put(`/playlists/${playlistId}/items`, { items });
    return updated;
  }

  function currentItemsState() {
    return [...document.querySelectorAll('#items-list li')].map((li) => {
      const durationInput = li.querySelector('input[data-duration]');
      return {
        contentId: li.dataset.contentId,
        durationOverride: durationInput ? Number(durationInput.value) || null : null,
      };
    });
  }

  document.getElementById('add-item')?.addEventListener('click', async () => {
    const picker = document.getElementById('content-picker');
    if (!picker.value) return;
    const selected = availableContent.find((c) => c.id === picker.value);
    const items = document.getElementById('items-list') ? currentItemsState() : [];
    items.push({
      contentId: picker.value,
      durationOverride: selected?.type === 'video' ? null : selected?.type === 'website' ? 30 : 10,
    });
    await saveItems(items);
    renderEditor(root, playlistId, isAdmin);
  });

  root.querySelectorAll('[data-duration]').forEach((input) => {
    input.addEventListener('change', async () => {
      await saveItems(currentItemsState());
      renderEditor(root, playlistId, isAdmin);
    });
  });

  root.querySelectorAll('[data-move]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const li = btn.closest('li');
      const items = currentItemsState();
      const index = items.findIndex((i) => i.contentId === li.dataset.contentId);
      const swapWith = btn.dataset.move === 'up' ? index - 1 : index + 1;
      if (swapWith < 0 || swapWith >= items.length) return;
      [items[index], items[swapWith]] = [items[swapWith], items[index]];
      await saveItems(items);
      renderEditor(root, playlistId, isAdmin);
    });
  });

  root.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const li = btn.closest('li');
      const items = currentItemsState().filter((i) => i.contentId !== li.dataset.contentId);
      await saveItems(items);
      renderEditor(root, playlistId, isAdmin);
    });
  });
}
