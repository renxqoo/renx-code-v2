import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { use__HOOK_NAME__ } from './use-__hook-name__';
import * as serviceModule from './service';

describe('use__HOOK_NAME__', () => {
  it('loads data successfully', async () => {
    vi.spyOn(serviceModule, '__SERVICE_NAME__').mockResolvedValue({
      title: 'Loaded',
    });

    const { result } = renderHook(() => use__HOOK_NAME__());

    await act(async () => {
      await result.current.reload();
    });

    await waitFor(() => {
      expect(result.current.data).toEqual({ title: 'Loaded' });
      expect(result.current.error).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('captures service failure', async () => {
    vi.spyOn(serviceModule, '__SERVICE_NAME__').mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => use__HOOK_NAME__());

    await act(async () => {
      await result.current.reload();
    });

    await waitFor(() => {
      expect(result.current.data).toBeNull();
      expect(result.current.error?.message).toBe('boom');
      expect(result.current.isLoading).toBe(false);
    });
  });
});
