import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useRunInspector } from './use-run-inspector';

describe('useRunInspector', () => {
  it('toggles visibility and resets to Meta when opening', () => {
    const { result } = renderHook(() => useRunInspector());

    expect(result.current.visible).toBe(false);
    expect(result.current.activeTab).toBe('Meta');

    act(() => {
      result.current.cycleTab(1);
      result.current.open();
    });
    expect(result.current.visible).toBe(true);
    expect(result.current.activeTab).toBe('Meta');

    act(() => {
      result.current.toggle();
    });
    expect(result.current.visible).toBe(false);

    act(() => {
      result.current.toggle();
    });
    expect(result.current.visible).toBe(true);
    expect(result.current.activeTab).toBe('Meta');
  });

  it('cycles tabs while visible', () => {
    const { result } = renderHook(() => useRunInspector());

    act(() => {
      result.current.open();
      result.current.cycleTab(1);
    });
    expect(result.current.activeTab).toBe('Timeline');

    act(() => {
      result.current.cycleTab(1);
    });
    expect(result.current.activeTab).toBe('Artifacts');

    act(() => {
      result.current.cycleTab(-1);
    });
    expect(result.current.activeTab).toBe('Timeline');
  });
});
