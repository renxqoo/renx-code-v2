import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { uiTheme } from '../../ui/theme';
import { PromptCard } from './prompt-card';

describe('PromptCard', () => {
  it('renders the user message rail in gray instead of accent', () => {
    const { container } = render(<PromptCard prompt="hello" isFirst={true} />);
    const rootBox = container.querySelector('box');
    const railBox = rootBox?.firstElementChild as HTMLElement | null;

    expect(railBox).toBeTruthy();
    expect(railBox?.getAttribute('bordercolor')).toBe(uiTheme.divider);
  });
});
