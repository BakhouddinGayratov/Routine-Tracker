/**
 * API client.
 *
 * One place that knows about transport concerns: JSON encoding, the auth
 * token, and turning a non-2xx response into a typed error the views can
 * render (including per-field messages from the server's validator).
 */

const TOKEN_KEY = 'rt.token';

export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields || null;
  }
}

export const auth = {
  get token() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set token(value) {
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    } catch { /* private mode — the cookie still carries the session */ }
  },
};

async function request(method, path, body, options = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = auth.token;
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }

  if (res.status === 204) return null;

  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    const error = payload?.error || {};
    throw new ApiError(res.status, error.message || `Request failed (${res.status})`, error.fields);
  }
  return payload;
}

const get = (path, options) => request('GET', path, undefined, options);
const post = (path, body) => request('POST', path, body ?? {});
const patch = (path, body) => request('PATCH', path, body);
const put = (path, body) => request('PUT', path, body);
const del = (path, body) => request('DELETE', path, body);

export const api = {
  // Auth ------------------------------------------------------------------
  register: (data) => post('/auth/register', data),
  login: (data) => post('/auth/login', data),
  logout: () => post('/auth/logout'),
  me: () => get('/auth/me'),
  updateProfile: (data) => patch('/auth/me', data),
  changePassword: (data) => post('/auth/password', data),
  sessions: () => get('/auth/sessions'),
  revokeSession: (id) => del(`/auth/sessions/${id}`),
  deleteAccount: (password) => del('/auth/me', { password }),

  // Routines --------------------------------------------------------------
  routines: (all = false) => get(`/routines${all ? '?archived=all' : ''}`),
  routine: (id) => get(`/routines/${id}`),
  createRoutine: (data) => post('/routines', data),
  updateRoutine: (id, data) => patch(`/routines/${id}`, data),
  deleteRoutine: (id) => del(`/routines/${id}`),
  duplicateRoutine: (id) => post(`/routines/${id}/duplicate`),
  reorderRoutines: (ids) => post('/routines/reorder', { ids }),

  // Goals -----------------------------------------------------------------
  goals: (all = false) => get(`/goals${all ? '?status=all' : ''}`),
  createGoal: (data) => post('/goals', data),
  updateGoal: (id, data) => patch(`/goals/${id}`, data),
  deleteGoal: (id) => del(`/goals/${id}`),

  // Days & logs -----------------------------------------------------------
  day: (date) => get(`/days/${date}`),
  week: (date) => get(`/days/${date}/week`),
  month: (year, month) => get(`/days/month/${year}/${month}`),
  log: (data) => post('/days/log', data),
  completeAll: (date) => post(`/days/${date}/complete-all`),
  copyFrom: (date, source) => post(`/days/${date}/copy-from`, { source }),
  upcoming: (days = 7) => get(`/days/upcoming/list?days=${days}`),

  // Stats -----------------------------------------------------------------
  summary: () => get('/stats/summary'),
  overview: (days = 30) => get(`/stats/overview?days=${days}`),
  heatmap: (days = 182) => get(`/stats/heatmap?days=${days}`),
  routineStats: (days = 30) => get(`/stats/routines?days=${days}`),
  achievements: () => get('/stats/achievements'),

  // Journal ---------------------------------------------------------------
  journalList: (limit = 60) => get(`/journal?limit=${limit}`),
  journalEntry: (date) => get(`/journal/${date}`),
  saveJournal: (date, data) => put(`/journal/${date}`, data),

  // Misc ------------------------------------------------------------------
  templates: () => get('/templates'),
  applyTemplate: (id) => post(`/templates/${id}/apply`),
  search: (q, options) => get(`/search?q=${encodeURIComponent(q)}`, options),
  exportUrl: '/api/export',
  exportCsvUrl: '/api/export.csv',
};
