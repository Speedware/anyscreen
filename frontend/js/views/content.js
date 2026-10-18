import { api } from '../api.js';
import { ws } from '../ws.js';
import { escapeHtml, formatSize } from '../utils.js';

const TYPE_ICON = { video: '🎬', image: '🖼️', website: '🌐' };

function statusBadgeHtml(c) {
  if (c.type !== 'video') return '';
  if (c.processingStatus === 'processing') return '<span class="badge processing">Processing</span>';
  return c.optimized ? '<span class="badge optimized">Optimized</span>' : '';
}

function downloadName(c) {
  const ext = c.url.match(/\.[a-z0-9]+$/i)?.[0] ?? '';
  return ext && !c.name.toLowerCase().endsWith(ext.toLowerCase()) ? c.name + ext : c.name;
}

function downloadLinkHtml(c) {
  if (c.source !== 'upload') return '';
  return `<a class="secondary" href="${escapeHtml(c.url)}" download="${escapeHtml(downloadName(c))}" data-download>Download</a>`;
}

function rowHtml(c, isAdmin) {
  const details = `${c.type}${c.durationSeconds ? ` · ${c.durationSeconds}s` : ''}${c.muted ? ' · muted' : ''}`;
  return `
    <tr class="clickable-row" data-content-row="${c.id}">
      <td>${TYPE_ICON[c.type]} ${escapeHtml(c.name)}</td>
      <td class="text-dim">${details}</td>
      <td data-status>${statusBadgeHtml(c)}</td>
      <td style="text-align:right;white-space:nowrap">
        ${downloadLinkHtml(c)}${isAdmin ? `
        <button class="secondary" data-edit="${c.id}">Edit</button>
        <button class="danger" data-delete="${c.id}">Delete</button>
      ` : ''}</td>
    </tr>
  `;
}

function previewPanelHtml(item) {
  if (!item) return '<div class="empty-state">Click a row to preview it here.</div>';

  let media = '';
  if (item.type === 'video') {
    media = `<video src="${escapeHtml(item.url)}" controls style="width:100%;max-height:280px;background:#000;border-radius:8px"></video>`;
  } else if (item.type === 'image') {
    media = `<img src="${escapeHtml(item.url)}" alt="" class="zoomable" data-fullscreen title="Click to view full screen" style="width:100%;max-height:280px;object-fit:contain;background:#000;border-radius:8px" />`;
  } else {
    media = `
      <iframe src="${escapeHtml(item.url)}" style="width:100%;height:280px;border:1px solid var(--border);border-radius:8px;background:#fff"></iframe>
      <p class="text-dim" style="font-size:12px;margin-top:6px">Some sites block embedding — if it looks blank, <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">open it directly</a>.</p>
    `;
  }

  return `
    <div class="preview-media">${media}</div>
    <h3 style="margin-bottom:4px">${TYPE_ICON[item.type]} ${escapeHtml(item.name)}</h3>
    <div class="text-dim" style="font-size:13px">
      ${item.type}${item.durationSeconds ? ` · ${item.durationSeconds}s` : ''}${item.muted ? ' · muted' : ''}
    </div>
    ${item.source === 'upload' || item.type === 'image' ? `
    <div class="flex-row" style="margin-top:12px">
      ${item.type === 'image' ? '<button class="secondary" data-fullscreen>Full screen</button>' : ''}
      ${downloadLinkHtml(item)}
    </div>` : ''}
  `;
}

function openImageViewer(url) {
  const viewer = document.createElement('div');
  viewer.className = 'image-viewer';
  viewer.innerHTML = `<img src="${escapeHtml(url)}" alt="" />`;
  document.body.appendChild(viewer);

  const close = () => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    if (document.fullscreenElement === viewer) document.exitFullscreen().catch(() => {});
    viewer.remove();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const onFullscreenChange = () => { if (!document.fullscreenElement) close(); };

  viewer.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  viewer.requestFullscreen?.()
    .then(() => document.addEventListener('fullscreenchange', onFullscreenChange))
    .catch(() => {});
}

export async function renderContent(root) {
  const { content } = await api.get('/content');
  const isAdmin = api.getUser()?.role === 'admin';
  let selectedId = null;

  root.innerHTML = `
    <div class="page-header">
      <h1 class="mt-0">Content</h1>
      ${isAdmin ? `
      <div class="flex-row">
        <button class="secondary" id="add-url">Add website / URL</button>
        <button id="upload-file">Upload file</button>
      </div>` : ''}
    </div>
    <div class="content-layout">
      <div class="card content-list">
        ${content.length === 0
          ? '<div class="empty-state">No content yet. Upload a video/image or add a website URL.</div>'
          : `<table>
               <thead><tr><th>Name</th><th>Details</th><th>Status</th><th></th></tr></thead>
               <tbody>${content.map((c) => rowHtml(c, isAdmin)).join('')}</tbody>
             </table>`}
      </div>
      <div class="card content-preview" id="content-preview">${previewPanelHtml(null)}</div>
    </div>
  `;

  document.getElementById('upload-file')?.addEventListener('click', () => openUploadModal(root));
  document.getElementById('add-url')?.addEventListener('click', () => openUrlModal(root));

  function selectRow(id) {
    selectedId = id;
    const item = content.find((c) => c.id === id);
    document.getElementById('content-preview').innerHTML = previewPanelHtml(item);
    root.querySelectorAll('tr.clickable-row').forEach((row) => row.classList.toggle('selected', row.dataset.contentRow === id));
  }

  root.querySelectorAll('[data-content-row]').forEach((row) =>
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-edit], [data-delete], [data-download]')) return;
      selectRow(row.dataset.contentRow);
    }));

  document.getElementById('content-preview').addEventListener('click', (e) => {
    if (!e.target.closest('[data-fullscreen]')) return;
    const item = content.find((c) => c.id === selectedId);
    if (item?.type === 'image') openImageViewer(item.url);
  });

  root.querySelectorAll('[data-edit]').forEach((btn) =>
    btn.addEventListener('click', () => openEditModal(root, content.find((c) => c.id === btn.dataset.edit))));

  root.querySelectorAll('[data-delete]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this content item? It will be removed from any playlists using it.')) return;
      await api.del(`/content/${btn.dataset.delete}`);
      renderContent(root);
    }));

  ws.on('content:status', ({ id, status, optimized }) => {
    const item = content.find((c) => c.id === id);
    if (item) {
      item.processingStatus = status;
      item.optimized = optimized;
    }
    const cell = root.querySelector(`tr[data-content-row="${id}"] [data-status]`);
    if (cell && item) cell.innerHTML = statusBadgeHtml(item);
    if (selectedId === id) document.getElementById('content-preview').innerHTML = previewPanelHtml(item);
  });
}

function modal(root, innerHtml) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">${innerHtml}</div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  return overlay;
}

const MAX_UPLOAD_FILES = 15;

function openUploadModal(root) {
  const overlay = modal(root, `
    <h2 class="mt-0">Upload file</h2>
    <div id="modal-error"></div>
    <form id="upload-form">
      <div class="field">
        <label>File(s) — video or image, up to ${MAX_UPLOAD_FILES} at once</label>
        <div class="dropzone" id="dropzone" tabindex="0">
          <input type="file" name="files" accept="video/*,image/*" id="upload-input" multiple hidden />
          <div id="dropzone-prompt">
            <div class="dropzone-icon">⬆</div>
            <div>Drag &amp; drop files here, or click to browse</div>
          </div>
          <div id="dropzone-file" class="dropzone-file" style="display:none">
            <div id="dropzone-filelist" style="flex:1;max-height:140px;overflow:auto;text-align:left"></div>
            <button type="button" class="secondary" id="dropzone-clear">Change</button>
          </div>
        </div>
      </div>
      <div class="field" id="name-field">
        <label>Name</label>
        <input name="name" placeholder="Defaults to file name" />
      </div>
      <div class="field" id="mute-field" style="display:none">
        <label><input type="checkbox" name="muted" style="width:auto" /> Mute audio</label>
      </div>
      <div class="field" id="progress-field" style="display:none">
        <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
        <div class="text-dim" id="progress-label" style="margin-top:6px;font-size:12px"></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="secondary" id="cancel">Cancel</button>
        <button type="submit" id="upload-submit">Upload</button>
      </div>
    </form>
  `);

  const dropzone = overlay.querySelector('#dropzone');
  const fileInput = overlay.querySelector('#upload-input');
  const promptEl = overlay.querySelector('#dropzone-prompt');
  const fileEl = overlay.querySelector('#dropzone-file');
  const filelistEl = overlay.querySelector('#dropzone-filelist');
  const nameField = overlay.querySelector('#name-field');
  const muteField = overlay.querySelector('#mute-field');
  const progressField = overlay.querySelector('#progress-field');
  const progressFill = overlay.querySelector('#progress-fill');
  const progressLabel = overlay.querySelector('#progress-label');
  const submitBtn = overlay.querySelector('#upload-submit');
  const errorBox = overlay.querySelector('#modal-error');

  overlay.querySelector('#cancel').addEventListener('click', () => overlay.remove());

  function selectFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    if (files.length > MAX_UPLOAD_FILES) {
      errorBox.innerHTML = `<div class="error-banner">Choose at most ${MAX_UPLOAD_FILES} files at once (selected ${files.length}).</div>`;
      return;
    }
    errorBox.innerHTML = '';

    const transfer = new DataTransfer();
    files.forEach((f) => transfer.items.add(f));
    fileInput.files = transfer.files;

    promptEl.style.display = 'none';
    fileEl.style.display = 'flex';
    const heading = files.length === 1 ? '1 file selected' : `${files.length} files selected`;
    filelistEl.innerHTML = `<div style="margin-bottom:6px;font-weight:600">${heading}</div>`
      + files.map((f) => `<div>${escapeHtml(f.name)} <span class="text-dim">(${formatSize(f.size)})</span></div>`).join('');

    nameField.style.display = files.length === 1 ? 'block' : 'none';
    muteField.style.display = files.some((f) => f.type.startsWith('video/')) ? 'block' : 'none';
  }

  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('#dropzone-clear')) return;
    fileInput.click();
  });
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', () => selectFiles(fileInput.files));

  ['dragover', 'dragenter'].forEach((evt) => dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  }));
  ['dragleave', 'dragend'].forEach((evt) => dropzone.addEventListener(evt, () => dropzone.classList.remove('dragover')));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    selectFiles(e.dataTransfer.files);
  });

  overlay.querySelector('#dropzone-clear').addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.value = '';
    promptEl.style.display = 'block';
    fileEl.style.display = 'none';
    nameField.style.display = 'block';
  });

  overlay.querySelector('#upload-form').addEventListener('submit', (e) => {
    e.preventDefault();
    errorBox.innerHTML = '';
    if (!fileInput.files.length) {
      errorBox.innerHTML = '<div class="error-banner">Choose at least one file first</div>';
      return;
    }

    const formData = new FormData(e.target);
    const fileCount = fileInput.files.length;
    submitBtn.disabled = true;
    progressField.style.display = 'block';
    progressFill.style.width = '0%';
    progressLabel.textContent = `Uploading ${fileCount} file${fileCount > 1 ? 's' : ''}…`;

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/content/upload');
    const token = api.getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.addEventListener('progress', (evt) => {
      if (!evt.lengthComputable) return;
      const pct = Math.round((evt.loaded / evt.total) * 100);
      progressFill.style.width = `${pct}%`;
      progressLabel.textContent = `Uploading ${fileCount} file${fileCount > 1 ? 's' : ''}… ${pct}%`;
    });

    xhr.addEventListener('load', () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { }
      if (xhr.status >= 200 && xhr.status < 300) {
        progressFill.style.width = '100%';
        progressLabel.textContent = 'Done';
        overlay.remove();
        renderContent(document.getElementById('main'));
      } else {
        submitBtn.disabled = false;
        progressField.style.display = 'none';
        errorBox.innerHTML = `<div class="error-banner">${data.error || `Upload failed (${xhr.status})`}</div>`;
      }
    });

    xhr.addEventListener('error', () => {
      submitBtn.disabled = false;
      progressField.style.display = 'none';
      errorBox.innerHTML = '<div class="error-banner">Network error during upload</div>';
    });

    xhr.send(formData);
  });
}

function openUrlModal(root) {
  const overlay = modal(root, `
    <h2 class="mt-0">Add website / URL</h2>
    <div id="modal-error"></div>
    <form id="url-form">
      <div class="field">
        <label>Type</label>
        <select name="type" id="type-select">
          <option value="website">Website</option>
          <option value="video">Video (remote URL)</option>
          <option value="image">Image (remote URL)</option>
        </select>
      </div>
      <div class="field">
        <label>Name</label>
        <input name="name" required />
      </div>
      <div class="field">
        <label>URL</label>
        <input name="url" type="url" required placeholder="https://" />
      </div>
      <div class="field" id="mute-field" style="display:none">
        <label><input type="checkbox" name="muted" style="width:auto" /> Mute audio</label>
      </div>
      <div class="modal-actions">
        <button type="button" class="secondary" id="cancel">Cancel</button>
        <button type="submit">Add</button>
      </div>
    </form>
  `);
  overlay.querySelector('#cancel').addEventListener('click', () => overlay.remove());

  const muteField = overlay.querySelector('#mute-field');
  const typeSelect = overlay.querySelector('#type-select');
  const syncMuteField = () => { muteField.style.display = typeSelect.value === 'video' ? 'block' : 'none'; };
  typeSelect.addEventListener('change', syncMuteField);
  syncMuteField();

  overlay.querySelector('#url-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.muted = data.muted === 'on';
    try {
      await api.post('/content/url', data);
      overlay.remove();
      renderContent(document.getElementById('main'));
    } catch (err) {
      overlay.querySelector('#modal-error').innerHTML = `<div class="error-banner">${err.message}</div>`;
    }
  });
}

function openEditModal(root, item) {
  const overlay = modal(root, `
    <h2 class="mt-0">Edit ${escapeHtml(item.name)}</h2>
    <div id="modal-error"></div>
    <form id="edit-form">
      <div class="field">
        <label>Name</label>
        <input name="name" value="${escapeHtml(item.name)}" required />
      </div>
      ${item.type === 'video' ? `
      <div class="field">
        <label><input type="checkbox" name="muted" style="width:auto" ${item.muted ? 'checked' : ''} /> Mute audio</label>
      </div>` : ''}
      <div class="modal-actions">
        <button type="button" class="secondary" id="cancel">Cancel</button>
        <button type="submit">Save</button>
      </div>
    </form>
  `);
  overlay.querySelector('#cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.muted = data.muted === 'on';
    try {
      await api.patch(`/content/${item.id}`, data);
      overlay.remove();
      renderContent(document.getElementById('main'));
    } catch (err) {
      overlay.querySelector('#modal-error').innerHTML = `<div class="error-banner">${err.message}</div>`;
    }
  });
}
