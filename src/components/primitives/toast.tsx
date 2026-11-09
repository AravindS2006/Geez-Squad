'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import styles from './toast.module.css';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';
type ToastItem = { id: number; tone: ToastTone; message: string };
type ToastApi = { show: (message: string, tone?: ToastTone) => void };

const ToastContext = createContext<ToastApi>({ show: () => {} });
const icons = { success: CheckCircle2, info: Info, warning: TriangleAlert, error: TriangleAlert };

/** App-wide, non-blocking status messages. Errors stay until dismissed. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);
  const show = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = nextId.current++;
      setItems((list) =>
        [...list.filter((item) => item.message !== message), { id, tone, message }].slice(-4),
      );
      if (tone !== 'error')
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), 5000),
        );
    },
    [dismiss],
  );
  useEffect(() => {
    const active = timers.current;
    return () => active.forEach((timer) => clearTimeout(timer));
  }, []);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.region} role="region" aria-label="Notifications">
        <div aria-live="polite" aria-atomic="false" className={styles.stack}>
          {items.map((item) => {
            const Icon = icons[item.tone];
            return (
              <div
                key={item.id}
                className={`${styles.toast} ${styles[item.tone]}`}
                role={item.tone === 'error' ? 'alert' : 'status'}
              >
                <Icon size={18} aria-hidden />
                <span>{item.message}</span>
                <button
                  type="button"
                  className={styles.close}
                  onClick={() => dismiss(item.id)}
                  aria-label="Dismiss notification"
                >
                  <X size={16} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
