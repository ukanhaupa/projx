import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '@/components/Toast';

function Harness() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast('Saved', 'success')}>success</button>
      <button onClick={() => toast('Boom', 'error')}>error</button>
      <button onClick={() => toast('Heads up', 'warning')}>warning</button>
      <button onClick={() => toast('FYI')}>default</button>
    </div>
  );
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  function setup() {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    return user;
  }

  it('renders a success toast in the polite live region', async () => {
    const user = setup();
    await user.click(screen.getByText('success'));
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('Saved').closest('.toast')).toHaveClass(
      'toast-success',
    );
  });

  it('renders an error toast in the assertive live region', async () => {
    const user = setup();
    await user.click(screen.getByText('error'));
    const region = screen.getByText('Boom').closest('[aria-live]');
    expect(region).toHaveAttribute('aria-live', 'assertive');
  });

  it('defaults to the info type', async () => {
    const user = setup();
    await user.click(screen.getByText('default'));
    expect(screen.getByText('FYI').closest('.toast')).toHaveClass('toast-info');
  });

  it('auto-dismisses after its duration elapses', async () => {
    const user = setup();
    await user.click(screen.getByText('warning'));
    expect(screen.getByText('Heads up')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(6000 + 200);
    });
    expect(screen.queryByText('Heads up')).not.toBeInTheDocument();
  });

  it('dismisses when the close button is clicked', async () => {
    const user = setup();
    await user.click(screen.getByText('success'));
    await user.click(
      screen.getByRole('button', { name: 'Dismiss notification' }),
    );
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('pauses the dismiss timer on hover and resumes on leave', async () => {
    const user = setup();
    await user.click(screen.getByText('success'));
    const toast = screen.getByText('Saved').closest('.toast')!;
    await user.hover(toast);
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText('Saved')).toBeInTheDocument();
    await user.unhover(toast);
    await act(async () => {
      vi.advanceTimersByTime(4000 + 200);
    });
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('caps the number of visible toasts at three', async () => {
    const user = setup();
    for (let i = 0; i < 4; i++) {
      await user.click(screen.getByText('warning'));
    }
    expect(screen.getAllByText('Heads up')).toHaveLength(3);
  });
});
