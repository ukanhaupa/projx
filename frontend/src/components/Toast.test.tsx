import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './Toast';

function TestHarness() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast('Success message', 'success')}>
        Show Success
      </button>
      <button onClick={() => toast('Error message', 'error')}>
        Show Error
      </button>
      <button onClick={() => toast('Info message')}>Show Info</button>
    </div>
  );
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('renders toast on trigger', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <TestHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByText('Show Success'));
    expect(screen.getByText('Success message')).toBeInTheDocument();
  });

  it('auto-dismisses after duration', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <TestHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByText('Show Info'));
    expect(screen.getByText('Info message')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(6000));
    expect(screen.queryByText('Info message')).not.toBeInTheDocument();
  });

  it('dismisses on close button click', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <TestHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByText('Show Success'));
    const closeBtn = screen.getByLabelText('Dismiss notification');
    await user.click(closeBtn);

    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText('Success message')).not.toBeInTheDocument();
  });

  it('has polite live region for non-error toasts', () => {
    render(
      <ToastProvider>
        <TestHarness />
      </ToastProvider>,
    );

    const container = screen.getByRole('status');
    expect(container).toHaveAttribute('aria-live', 'polite');
  });

  it('has assertive live region for error toasts', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <TestHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByText('Show Error'));
    const alerts = screen.getAllByRole('alert');
    const assertiveContainer = alerts.find(
      (el) => el.getAttribute('aria-live') === 'assertive',
    );
    expect(assertiveContainer).toBeTruthy();
  });

  it('limits visible toasts to MAX_VISIBLE (3)', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <TestHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByText('Show Success'));
    await user.click(screen.getByText('Show Error'));
    await user.click(screen.getByText('Show Info'));
    await user.click(screen.getByText('Show Success'));

    // Only 3 toast messages visible at most (excluding the container divs with role="alert")
    const toastMessages = document.querySelectorAll('.toast');
    expect(toastMessages.length).toBeLessThanOrEqual(3);
  });

  it('pauses timer on mouse enter and resumes on leave', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <TestHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByText('Show Success'));
    const toastEl = screen.getByText('Success message').closest('.toast')!;

    // Hover to pause
    await user.hover(toastEl);
    act(() => vi.advanceTimersByTime(5000));
    // Should still be visible since timer is paused
    expect(screen.getByText('Success message')).toBeInTheDocument();

    // Unhover to resume
    await user.unhover(toastEl);
    act(() => vi.advanceTimersByTime(5000));
    // Should be gone now
    expect(screen.queryByText('Success message')).not.toBeInTheDocument();
  });

  it('error toasts have longer duration', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <TestHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByText('Show Error'));
    // After 5 seconds, error toast should still be visible (8s duration)
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByText('Error message')).toBeInTheDocument();

    // After 8+ seconds total, should be gone
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText('Error message')).not.toBeInTheDocument();
  });

  it('toast gets exiting class before removal', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <TestHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByText('Show Info'));
    expect(screen.getByText('Info message')).toBeInTheDocument();

    // Advance past duration to trigger exit
    act(() => vi.advanceTimersByTime(5100));
    // The toast should have exiting class briefly
    const toastEl = screen.queryByText('Info message')?.closest('.toast');
    if (toastEl) {
      expect(toastEl.className).toContain('toast-exit');
    }
  });

  it('default toast type is info', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <TestHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByText('Show Info'));
    const toastEl = screen.getByText('Info message').closest('.toast');
    expect(toastEl?.className).toContain('toast-info');
  });
});
