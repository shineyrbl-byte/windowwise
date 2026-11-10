import { describe, it, expect, vi } from 'vitest';
import { validWebhook, buildWebhook, sendWebhook } from '../src/webhook.js';

describe('webhook', () => {
  it('only allows https (or local http)', () => {
    expect(validWebhook('https://maker.ifttt.com/trigger/x/with/key/y')).toBe(true);
    expect(validWebhook('http://localhost:8123/api/webhook/abc')).toBe(true);
    expect(validWebhook('http://example.com/hook')).toBe(false);
    expect(validWebhook('javascript:alert(1)')).toBe(false);
    expect(validWebhook('not a url')).toBe(false);
  });

  it('puts values in the query and body', () => {
    const r = buildWebhook('https://example.com/hook?k=1', { action: 'open', place: 'Goa', reason: 'cool', text: 'Outside is cooler', time: 't' });
    const u = new URL(r.url);
    expect(u.searchParams.get('k')).toBe('1');
    expect(u.searchParams.get('value1')).toBe('open');
    expect(JSON.parse(r.body)).toMatchObject({ action: 'open', place: 'Goa', reason: 'cool' });
  });

  it('refuses to send to an invalid URL', async () => {
    const f = vi.fn();
    await expect(sendWebhook('http://example.com', {}, f)).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});
