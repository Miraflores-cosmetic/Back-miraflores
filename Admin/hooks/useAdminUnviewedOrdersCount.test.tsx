/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchAdminOrdersUnviewedRefresh,
  useAdminUnviewedOrdersCount,
} from './useAdminUnviewedOrdersCount';

const backendJson = vi.fn();

vi.mock('@/lib/adminBackendFetch', () => ({
  adminBackendJson: (...args: unknown[]) => backendJson(...args),
}));

describe('useAdminUnviewedOrdersCount', () => {
  afterEach(() => {
    cleanup();
    backendJson.mockReset();
  });

  it('refetches after the order page signals a view', async () => {
    backendJson.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 1 });
    const { result } = renderHook(() => useAdminUnviewedOrdersCount(true, '/admin/orders/o1'));

    await waitFor(() => expect(result.current).toBe(2));
    act(() => dispatchAdminOrdersUnviewedRefresh());
    await waitFor(() => expect(result.current).toBe(1));
    expect(backendJson).toHaveBeenCalledWith('orders/admin/unviewed-count');
  });

  it('keeps the last value on a transient error', async () => {
    backendJson.mockResolvedValueOnce({ count: 3 }).mockRejectedValueOnce(new Error('net'));
    const { result } = renderHook(() => useAdminUnviewedOrdersCount(true, '/admin'));

    await waitFor(() => expect(result.current).toBe(3));
    act(() => dispatchAdminOrdersUnviewedRefresh());
    await waitFor(() => expect(backendJson).toHaveBeenCalledTimes(2));
    expect(result.current).toBe(3);
  });

  it('does not call the backend without orders access', async () => {
    const { result } = renderHook(() => useAdminUnviewedOrdersCount(false, '/admin'));
    act(() => dispatchAdminOrdersUnviewedRefresh());
    expect(result.current).toBe(0);
    expect(backendJson).not.toHaveBeenCalled();
  });
});
