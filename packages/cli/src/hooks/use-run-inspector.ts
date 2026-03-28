import { useCallback, useState } from 'react';

import { cycleInspectorTab, type InspectorTab } from '../utils/run-inspector-tabs';

type UseRunInspectorResult = {
  visible: boolean;
  activeTab: InspectorTab;
  open: () => void;
  close: () => void;
  toggle: () => void;
  cycleTab: (delta: number) => void;
  setActiveTab: (tab: InspectorTab) => void;
};

export const useRunInspector = (): UseRunInspectorResult => {
  const [visible, setVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<InspectorTab>('Meta');

  const open = useCallback(() => {
    setActiveTab('Meta');
    setVisible(true);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
  }, []);

  const toggle = useCallback(() => {
    setVisible((current) => {
      const nextVisible = !current;
      if (nextVisible) {
        setActiveTab('Meta');
      }
      return nextVisible;
    });
  }, []);

  const cycleTab = useCallback((delta: number) => {
    setActiveTab((current) => cycleInspectorTab(current, delta));
  }, []);

  return {
    visible,
    activeTab,
    open,
    close,
    toggle,
    cycleTab,
    setActiveTab,
  };
};
