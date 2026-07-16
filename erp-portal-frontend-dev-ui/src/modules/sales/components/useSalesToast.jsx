import { useCallback, useEffect, useRef, useState } from "react";

/** Fixed-position toast notice (portal-themed). */
export function SalesToast({ toast }) {
  if (!toast?.msg) return null;
  const type = toast.type === "warning" ? "warn" : toast.type || "success";
  return (
    <div className={`sales-toast sales-toast--${type}`} role="status" aria-live="polite">
      {toast.msg}
    </div>
  );
}

/**
 * Shared toast state for sales pages — replaces inline setToast / showToast patterns.
 * @param {number} defaultDurationMs — auto-dismiss delay (default 4000)
 */
export default function useSalesToast(defaultDurationMs = 4000) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const dismissToast = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback(
    (msg, type = "success", durationMs = defaultDurationMs) => {
      if (!msg) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      const normalized = type === "warning" ? "warn" : type;
      setToast({ msg: String(msg), type: normalized });
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setToast(null);
      }, durationMs);
    },
    [defaultDurationMs]
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return { toast, showToast, dismissToast };
}
