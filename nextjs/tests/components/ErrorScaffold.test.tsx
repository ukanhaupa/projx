import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ErrorScaffold } from '@/components/ErrorScaffold';

describe('ErrorScaffold', () => {
  afterEach(cleanup);

  it('renders a consistent not-found state', () => {
    render(<ErrorScaffold variant='not-found' />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('renders the forbidden state defaults', () => {
    render(<ErrorScaffold variant='forbidden' />);
    expect(screen.getByText('403')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Access denied' }),
    ).toBeInTheDocument();
  });

  it('keeps primary and secondary action variants distinct', () => {
    render(
      <ErrorScaffold
        variant='server-error'
        primaryAction={{ label: 'Retry', onClick: vi.fn() }}
        secondaryAction={{ label: 'Go home', href: '/' }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveAttribute(
      'data-variant',
      'primary',
    );
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute(
      'data-variant',
      'secondary',
    );
  });

  it('runs button actions', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <ErrorScaffold
        variant='boundary'
        primaryAction={{ label: 'Retry', onClick }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('honors a custom code and message override', () => {
    render(
      <ErrorScaffold variant='boundary' code='418' message='I am a teapot' />,
    );
    expect(screen.getByText('418')).toBeInTheDocument();
    expect(screen.getByText('I am a teapot')).toBeInTheDocument();
  });
});
