import { useEffect } from "react";

/** Close manufacturing modals on Escape — used by components/Modal.jsx only. */
export function useMfgModalEscape(open, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}
