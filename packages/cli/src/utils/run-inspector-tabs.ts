export const INSPECTOR_TABS = ['Meta', 'Timeline', 'Artifacts', 'Debug'] as const;

export type InspectorTab = (typeof INSPECTOR_TABS)[number];

export const cycleInspectorTab = (currentTab: InspectorTab, delta: number): InspectorTab => {
  if (delta === 0) {
    return currentTab;
  }

  const currentIndex = INSPECTOR_TABS.indexOf(currentTab);
  const normalizedIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (normalizedIndex + delta % INSPECTOR_TABS.length + INSPECTOR_TABS.length) % INSPECTOR_TABS.length;
  return INSPECTOR_TABS[nextIndex] ?? 'Meta';
};
