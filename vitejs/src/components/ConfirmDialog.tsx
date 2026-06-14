import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmCtx = createContext<ConfirmContextValue>({
  confirm: () => Promise.resolve(false),
});

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<(value: boolean) => void>(undefined);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    setOptions(opts);
    return new Promise((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const close = useCallback((result: boolean) => {
    resolveRef.current?.(result);
    setOptions(null);
  }, []);

  useEffect(() => {
    if (!options) return;
    cancelBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [options, close]);

  return (
    <ConfirmCtx.Provider value={{ confirm }}>
      {children}
      {options && (
        <div
          className='modal-overlay'
          onClick={() => close(false)}
          role='dialog'
          aria-modal='true'
          aria-labelledby='confirm-dialog-title'
          aria-describedby='confirm-dialog-message'
        >
          <div
            className='modal confirm-dialog'
            ref={dialogRef}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id='confirm-dialog-title'>{options.title ?? 'Confirm'}</h3>
            <p
              id='confirm-dialog-message'
              style={{
                color: 'var(--color-text-secondary)',
                margin: 'var(--space-4) 0',
              }}
            >
              {options.message}
            </p>
            <div className='form-actions'>
              <button
                type='button'
                ref={cancelBtnRef}
                onClick={() => close(false)}
              >
                {options.cancelLabel ?? 'Cancel'}
              </button>
              <button
                type='button'
                className={`confirm-btn ${options.variant ?? 'primary'}`}
                onClick={() => close(true)}
              >
                {options.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmCtx).confirm;
