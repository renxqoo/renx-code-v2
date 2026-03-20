import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { __COMPONENT_NAME__ } from './component';

describe('__COMPONENT_NAME__', () => {
  it('renders required content', () => {
    render(<__COMPONENT_NAME__ title="Hello" description="World" />);

    expect(screen.getByText('Hello')).toBeTruthy();
    expect(screen.getByText('World')).toBeTruthy();
  });

  it('fires the callback when pressed', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();

    render(<__COMPONENT_NAME__ title="Hello" onPress={onPress} />);

    await user.click(screen.getByText('Hello'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
