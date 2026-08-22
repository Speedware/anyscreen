function getToken() {
  return localStorage.getItem('anyscreen_token');
}

function setToken(token) {
  if (token) localStorage.setItem('anyscreen_token', token);
  else localStorage.removeItem('anyscreen_token');
}

function getUser() {
  const raw = localStorage.getItem('anyscreen_user');
  return raw ? JSON.parse(raw) : null;
}

function setUser(user) {
  if (user) localStorage.setItem('anyscreen_user', JSON.stringify(user));
  else localStorage.removeItem('anyscreen_user');
}

async function request(method, path, body) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const opts = { method, headers };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`/api${path}`, opts);
  if (res.status === 401) {
    setToken(null);
    setUser(null);
    location.hash = '#/login';
    throw new Error('Session expired, please log in again');
  }
  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path),
  getToken,
  setToken,
  getUser,
  setUser,
};
