import { describe, expect, it } from 'vitest';

import { cycleInspectorTab, INSPECTOR_TABS, type InspectorTab } from './run-inspector-tabs';

describe('run-inspector-tabs', () => {
  it('cycles forward through tabs and wraps around', () => {
    expect(cycleInspectorTab('Meta', 1)).toBe('Timeline');
    expect(cycleInspectorTab('Debug', 1)).toBe('Meta');
  });

  it('cycles backward through tabs and wraps around', () => {
    expect(cycleInspectorTab('Meta', -1)).toBe('Debug');
    expect(cycleInspectorTab('Artifacts', -1)).toBe('Timeline');
  });

  it('keeps the tab when delta is zero', () => {
    INSPECTOR_TABS.forEach((tab) => {
      expect(cycleInspectorTab(tab as InspectorTab, 0)).toBe(tab);
    });
  });
});
