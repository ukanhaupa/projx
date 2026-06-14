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

import ErrorRoute from '@/app/error';

describe('error route boundary', () => {
  beforeEach(() => captureException.mockReset());
  afterEach(cleanup);

  it('reports the error to Sentry on mount', () => {
    const error = new Error('kaboom');
    render(<ErrorRoute error={error} reset={vi.fn()} />);
    expect(captureException).toHaveBeenCalledWith(error);
  });

  it('renders the boundary scaffold with a retry action', async () => {
    const reset = vi.fn();
    const user = userEvent.setup();
    render(<ErrorRoute error={new Error('x')} reset={reset} />);
    expect(
      screen.getByRole('heading', { name: 'Something went wrong' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
