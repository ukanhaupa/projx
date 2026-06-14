import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);

import { Providers } from '@/components/Providers';
import { useTheme } from '@/components/ThemeProvider';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';

function Probe() {
  const { theme } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  return (
    <div data-testid='probe' data-theme={theme}>
      {typeof toast === 'function' && typeof confirm === 'function'
        ? 'wired'
        : 'missing'}
    </div>
  );
}

describe('Providers', () => {
  afterEach(cleanup);

  it('mounts the theme, toast, and confirm providers around children', () => {
    render(
      <Providers>
        <Probe />
      </Providers>,
    );
    const probe = screen.getByTestId('probe');
    expect(probe).toHaveTextContent('wired');
    expect(probe).toHaveAttribute('data-theme', 'light');
  });
});
