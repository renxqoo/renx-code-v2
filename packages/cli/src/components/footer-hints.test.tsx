import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FooterHints } from './footer-hints';

describe('FooterHints', () => {
  it('shows run navigation and inspector hints', () => {
    const { container } = render(
      <FooterHints isThinking={false} contextUsagePercent={42} isFullAccessMode={false} taskPanelVisible />
    );

    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(text).toContain('ctrl+t');
    expect(text).toContain('runs off');
    expect(text).toContain('↑↓ select run');
    expect(text).toContain('enter expand');
    expect(text).toContain('i inspector');
    expect(text).toContain('←→ tabs');
    expect(text).toContain('context 42%');
  });
});
