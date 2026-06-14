import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorScaffold } from '../../src/components/ErrorScaffold';

describe('ErrorScaffold', () => {
  afterEach(() => {
    cleanup();
  });

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

  it('keeps primary and secondary action variants distinct', () => {
    render(
      <ErrorScaffold
        variant='server-error'
        primaryAction={{ label: 'Retry', onClick: vi.fn() }}
        secondaryAction={{ label: 'Go home', href: '/' }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Retry' })).toHaveClass(
      'error-scaffold__action--primary',
    );
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveClass(
      'error-scaffold__action--secondary',
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
});
