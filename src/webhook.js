// Smart-home hook: when the plan says to open or close, call a URL the user
// chose (IFTTT, Home Assistant, Node-RED...). Sent straight from this device.

export function validWebhook(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname));
  } catch {
    return false;
  }
}

// Values go in the query string (IFTTT-style value1..3) and as a JSON body.
export function buildWebhook(url, { action, place, reason, text, time }) {
  const u = new URL(url);
  u.searchParams.set('value1', action);
  u.searchParams.set('value2', place);
  u.searchParams.set('value3', text);
  const body = JSON.stringify({ action, place, reason, text, time, source: 'WindowWise' });
  return { url: u.toString(), body };
}

export async function sendWebhook(url, payload, fetchFn = fetch) {
  if (!validWebhook(url)) throw new Error('invalid');
  const req = buildWebhook(url, payload);
  // no-cors: most smart-home endpoints don't send CORS headers. The request
  // still arrives; we just can't read the reply.
  await fetchFn(req.url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: req.body });
}
