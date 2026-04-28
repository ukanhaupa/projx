import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConfirmProvider,
  useConfirm,
} from '../../src/components/ConfirmDialog';

function TestHarness({ onResult }: { onResult: (v: boolean) => void }) {
  const confirm = useConfirm();
  const handleClick = async () => {
    const result = await confirm({
      title: 'Delete Item',
      message: 'Are you sure?',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    onResult(result);
  };
  return <button onClick={handleClick}>Trigger</button>;
}

describe('ConfirmDialog', () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = '';
  });

  it('shows dialog with correct content', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <TestHarness onResult={() => {}} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByText('Trigger'));

    expect(screen.getByText('Delete Item')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('resolves true on confirm', async () => {
    const user = userEvent.setup();
    let result: boolean | null = null;
    render(
      <ConfirmProvider>
        <TestHarness onResult={(v) => (result = v)} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByText('Trigger'));
    await user.click(screen.getByText('Delete'));

    expect(result).toBe(true);
  });

  it('resolves false on cancel', async () => {
    const user = userEvent.setup();
    let result: boolean | null = null;
    render(
      <ConfirmProvider>
        <TestHarness onResult={(v) => (result = v)} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByText('Trigger'));
    await user.click(screen.getByText('Cancel'));

    expect(result).toBe(false);
  });

  it('has dialog role and aria attributes', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <TestHarness onResult={() => {}} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByText('Trigger'));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'confirm-dialog-title');
  });

  it('closes on escape key', async () => {
    const user = userEvent.setup();
    let result: boolean | null = null;
    render(
      <ConfirmProvider>
        <TestHarness onResult={(v) => (result = v)} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByText('Trigger'));
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();

    await act(async () => {
      await user.keyboard('{Escape}');
    });

    expect(result).toBe(false);
  });

  it('closes when clicking the overlay backdrop', async () => {
    const user = userEvent.setup();
    let result: boolean | null = null;
    render(
      <ConfirmProvider>
        <TestHarness onResult={(v) => (result = v)} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByText('Trigger'));
    const overlay = screen.getByRole('dialog');
    await user.click(overlay);

    expect(result).toBe(false);
  });

  it('does not close when clicking modal content', async () => {
    const user = userEvent.setup();
    let result: boolean | null = null;
    render(
      <ConfirmProvider>
        <TestHarness onResult={(v) => (result = v)} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByText('Trigger'));
    const modalContent = screen.getByText('Are you sure?').closest('.modal')!;
    await user.click(modalContent);

    // Should still be open, no result yet
    expect(result).toBeNull();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('uses default title and labels when not provided', async () => {
    const user = userEvent.setup();
    function MinimalHarness() {
      const confirm = useConfirm();
      const handleClick = async () => {
        await confirm({ message: 'Proceed?' });
      };
      return <button onClick={handleClick}>Open</button>;
    }
    render(
      <ConfirmProvider>
        <MinimalHarness />
      </ConfirmProvider>,
    );

    await user.click(screen.getByText('Open'));
    // Title is 'Confirm' by default
    expect(screen.getByText('Proceed?')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    // Default confirmLabel is 'Confirm' and default variant is 'primary'
    const confirmBtns = screen.getAllByText('Confirm');
    const confirmBtn = confirmBtns.find(
      (el) => el.tagName === 'BUTTON' && el.classList.contains('confirm-btn'),
    );
    expect(confirmBtn?.className).toContain('primary');
  });

  it('locks body scroll when open and restores on close', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <TestHarness onResult={() => {}} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByText('Trigger'));
    expect(document.body.style.overflow).toBe('hidden');

    await user.click(screen.getByText('Cancel'));
    expect(document.body.style.overflow).toBe('');
  });

  it('traps focus with Tab key', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <TestHarness onResult={() => {}} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByText('Trigger'));
    // Tab cycling should not throw
    await user.tab();
    await user.tab();
    // Should cycle back
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('traps focus with Shift+Tab key', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <TestHarness onResult={() => {}} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByText('Trigger'));
    // Focus should be on cancel button initially
    const cancelBtn = screen.getByText('Cancel');
    cancelBtn.focus();
    await user.tab({ shift: true });
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('has aria-describedby pointing to message', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <TestHarness onResult={() => {}} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByText('Trigger'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute(
      'aria-describedby',
      'confirm-dialog-message',
    );
  });
});
