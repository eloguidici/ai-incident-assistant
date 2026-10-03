import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContentLimits } from './useContentLimits';

const apiMock = vi.fn();
vi.mock('../api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

describe('runtime content limits', () => {
  beforeEach(() => { apiMock.mockReset(); });

  it('uses server limits rather than build-time defaults', async () => {
    apiMock.mockResolvedValue({ sourceTextMax: 500, questionMax: 120, contentProtectionEnabled: true, personProtectionEnabled: false });
    const { result } = renderHook(useContentLimits);
    expect(result.current.limits).toBeNull();
    await waitFor(() => expect(result.current.limits).toEqual({ sourceTextMax: 500, questionMax: 120, contentProtectionEnabled: true, personProtectionEnabled: false }));
    expect(apiMock.mock.calls[0][0]).toBe('/api/analyses/limits');
  });

  it.each([{}, { sourceTextMax: 10, questionMax: 100 }, { sourceTextMax: 500, questionMax: 8001 },
    { sourceTextMax: '500', questionMax: 100 }, { sourceTextMax: 500.5, questionMax: 100 }])('does not guess limits for an invalid contract %j', async (value) => {
    apiMock.mockResolvedValue(value);
    const { result } = renderHook(useContentLimits);
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.limits).toBeNull();
  });

  it('closes on a network failure without leaking dependency errors', async () => {
    apiMock.mockRejectedValue(new Error('private dependency message'));
    const { result } = renderHook(useContentLimits);
    await waitFor(() => expect(result.current.error).toContain('Content limits could not be loaded'));
    expect(result.current.error).not.toContain('private');
    expect(result.current.limits).toBeNull();
  });

  it('aborts the request when the form unmounts', () => {
    apiMock.mockReturnValue(new Promise(() => undefined));
    const { unmount } = renderHook(useContentLimits);
    const signal = apiMock.mock.calls[0][1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
