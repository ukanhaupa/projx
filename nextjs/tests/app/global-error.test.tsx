import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureException = vi.fn();
vi.mock('@/lib/sentry', () => ({
  Sentry: { captureException: (e: unknown) => captureException(e) },
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import GlobalError from '@/app/global-error';

describe('global-error route boundary', () => {
  beforeEach(() => captureException.mockReset());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('reports the error to Sentry and renders the server-error scaffold', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('fatal');
    const reset = vi.fn();
    const user = userEvent.setup();
    render(<GlobalError error={error} reset={reset} />);

    expect(captureException).toHaveBeenCalledWith(error);
    expect(
      screen.getByRole('heading', { name: 'Unable to load' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
