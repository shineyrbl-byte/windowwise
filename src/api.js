// Client for the WindowWise API (worker/). Every call times out quickly and
// returns null on failure, so the app works the same without the server.
export const API_BASE = 'https://windowwise-api.f20240273.workers.dev';

async function call(path, { method = 'GET', body, headers = {}, timeout = 6000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let healthPromise = null;
const health = () => (healthPromise ||= call('/api/health').then((r) => r || {}));
// Which server features are available ({ plans, community, sensors, push, telegram }).
export const features = () => health().then((r) => r.features || {});
export const vapidKey = () => health().then((r) => r.vapidPublic || null);

export const createPlan = (plan) => call('/api/plans', { method: 'POST', body: plan });
export const getPlan = (id) => call(`/api/plans/${encodeURIComponent(id)}`);
export const updatePlan = (id, key, plan) => call(`/api/plans/${encodeURIComponent(id)}`, { method: 'PUT', body: plan, headers: { 'X-Edit-Key': key } });

export const nearbyRooms = (lat, lon) => call(`/api/community?lat=${lat}&lon=${lon}`);
export const shareRoom = (room) => call('/api/community', { method: 'POST', body: room });
export const unshareRoom = (device) => call('/api/community', { method: 'DELETE', body: { device } });

export const sensors = (lat, lon) => call(`/api/sensors?lat=${lat}&lon=${lon}`, { timeout: 8000 });

export const pushSubscribe = (sub) => call('/api/push', { method: 'POST', body: sub });
export const pushUnsubscribe = (endpoint) => call('/api/push', { method: 'DELETE', body: { endpoint } });
export const pushTest = (endpoint, title, body) => call('/api/push/test', { method: 'POST', body: { endpoint, title, body } });

export const telegramLink = (payload) => call('/api/telegram/link', { method: 'POST', body: payload });

// Short random ID for this device (used to update or remove a shared room).
export function deviceId(state) {
  if (!state.device) {
    const a = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    state.device = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => a[b % a.length]).join('');
  }
  return state.device;
}
