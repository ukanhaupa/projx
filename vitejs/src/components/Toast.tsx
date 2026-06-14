import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  exiting?: boolean;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastCtx = createContext<ToastContextValue>({ toast: () => {} });

const DURATION: Record<ToastType, number> = {
  success: 4000,
  error: 8000,
  warning: 6000,
  info: 5000,
};

const MAX_VISIBLE = 3;

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: number) => {
    timers.current.delete(id);
    setToasts((t) => t.map((v) => (v.id === id ? { ...v, exiting: true } : v)));
    setTimeout(() => {
      setToasts((t) => t.filter((v) => v.id !== id));
    }, 150);
  }, []);

  const startTimer = useCallback(
    (id: number, type: ToastType) => {
      const timer = setTimeout(() => removeToast(id), DURATION[type]);
      timers.current.set(id, timer);
    },
    [removeToast],
  );

  const pauseTimer = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = ++nextId;
      setToasts((t) => {
        const next = [...t, { id, message, type }];
        if (next.length > MAX_VISIBLE) {
          return next.slice(next.length - MAX_VISIBLE);
        }
        return next;
      });
      startTimer(id, type);
    },
    [startTimer],
  );

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className='toast-container' aria-label='Notifications'>
        <div role='status' aria-live='polite'>
          {toasts
            .filter((t) => t.type !== 'error')
            .map((t) => (
              <div
                key={t.id}
                className={`toast toast-${t.type}${t.exiting ? ' toast-exit' : ''}`}
                onMouseEnter={() => pauseTimer(t.id)}
                onMouseLeave={() => startTimer(t.id, t.type)}
                role='alert'
              >
                <span className='toast-message'>{t.message}</span>
                <button
                  className='toast-close'
                  onClick={() => removeToast(t.id)}
                  aria-label='Dismiss notification'
                >
                  &times;
                </button>
              </div>
            ))}
        </div>
        <div role='alert' aria-live='assertive'>
          {toasts
            .filter((t) => t.type === 'error')
            .map((t) => (
              <div
                key={t.id}
                className={`toast toast-${t.type}${t.exiting ? ' toast-exit' : ''}`}
                onMouseEnter={() => pauseTimer(t.id)}
                onMouseLeave={() => startTimer(t.id, t.type)}
                role='alert'
              >
                <span className='toast-message'>{t.message}</span>
                <button
                  className='toast-close'
                  onClick={() => removeToast(t.id)}
                  aria-label='Dismiss notification'
                >
                  &times;
                </button>
              </div>
            ))}
        </div>
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx).toast;
