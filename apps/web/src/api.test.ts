import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { ApiErrorCode, CsrfCookieName, CsrfHeaderName } from './constants';

describe('api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    document.cookie = `${CsrfCookieName}=csrf-test-token; path=/`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = `${CsrfCookieName}=; Max-Age=0; path=/`;
  });

  it('sends session credentials and the CSRF header on mutating requests', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    await api('/api/analyses', { method: 'POST', body: JSON.stringify({ sourceText: 'incident' }) });

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('include');
    const headers = new Headers(init.headers);
    expect(headers.get(CsrfHeaderName)).toBe('csrf-test-token');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('throws ApiError with structured API error bodies', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Not allowed.' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(api('/api/analyses/foreign')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Not allowed.',
      status: 403,
    });
  });

  it('throws ApiError when the error response is not JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('upstream unavailable', { status: 502 }));

    await expect(api('/api/health')).rejects.toMatchObject({
      code: ApiErrorCode.HttpError,
      message: 'The request could not be completed.',
      status: 502,
    });
  });

  it('propagates request cancellation to fetch', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.mocked(fetch).mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    await expect(api('/api/analyses/1', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});
