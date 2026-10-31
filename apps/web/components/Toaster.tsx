"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { EXPLORER } from "@/lib/config";
import { SPRING_BOUNCE, useCalm } from "@/lib/motion";
import { Icon } from "./Icon";
import { VLoader } from "./VLoader";
import styles from "./Toaster.module.css";

type ToastState = "pending" | "done" | "error";

interface Toast {
  id: number;
  state: ToastState;
  title: string;
  detail?: string;
  tx?: string;
}

interface ToastApi {
  /** Shows a toast for a transaction: pending with the V loader, then done or failed. */
  track: <T extends { tx?: string } | void>(opts: { pending: string; success: string; run: () => Promise<T> }) => Promise<T | null>;
}

const ToastContext = createContext<ToastApi>({ track: async () => null });
export const useToast = () => useContext(ToastContext);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const update = useCallback((id: number, patch: Partial<Toast>) => {
    setToasts((all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const later = useCallback(
    (id: number, ms: number) => {
      clearTimeout(timers.current.get(id));
      timers.current.set(id, setTimeout(() => dismiss(id), ms));
    },
    [dismiss],
  );

  const track = useCallback<ToastApi["track"]>(
    async ({ pending, success, run }) => {
      const id = nextId++;
      setToasts((all) => [...all.slice(-2), { id, state: "pending", title: pending }]);
      try {
        const result = await run();
        const tx = result && typeof result === "object" && "tx" in result ? result.tx : undefined;
        update(id, { state: "done", title: success, tx });
        later(id, 5200);
        return result;
      } catch (e) {
        update(id, { state: "error", title: "It didn't go through", detail: e instanceof Error ? e.message : undefined });
        later(id, 7000);
        return null;
      }
    },
    [update, later],
  );

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach(clearTimeout);
  }, []);

  const api = useMemo(() => ({ track }), [track]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  const calm = useCalm();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className={styles.stack} role="region" aria-label="Notifications" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            className={`${styles.toast} ${styles[t.state]}`}
            initial={calm ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.92, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={calm ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 12, transition: { duration: 0.22 } }}
            transition={calm ? { duration: 0.2 } : SPRING_BOUNCE}
          >
            <span className={styles.icon}>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={t.state}
                  className={styles.iconInner}
                  initial={calm ? { opacity: 0 } : { opacity: 0, scale: 0.4, rotate: -40 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={calm ? { duration: 0.15 } : SPRING_BOUNCE}
                >
                  {t.state === "pending" ? <VLoader size={22} /> : <Icon name={t.state === "done" ? "check" : "x"} size={16} stroke={3} />}
                </motion.span>
              </AnimatePresence>
            </span>
            <span className={styles.body}>
              <span className={styles.title}>{t.title}</span>
              {t.detail && <span className={styles.detail}>{t.detail}</span>}
              {t.tx && (
                <a className={styles.link} href={`${EXPLORER}/txns/${t.tx}`} target="_blank" rel="noreferrer">
                  View on NearBlocks <Icon name="external" size={12} stroke={2.25} />
                </a>
              )}
            </span>
            {t.state !== "pending" && (
              <button className={styles.close} onClick={() => onDismiss(t.id)} aria-label="Dismiss">
                <Icon name="x" size={14} stroke={2.25} />
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
