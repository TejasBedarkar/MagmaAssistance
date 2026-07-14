import { useCallback } from "react";
import toast from "react-hot-toast";

const DEFAULT_DURATION_MS = 3000;

function normalizeToast(input) {
  if (!input) return null;

  if (typeof input === "string") {
    const isError =
      input.startsWith("Error") ||
      input.includes("required") ||
      input.includes("must");
    return { type: isError ? "error" : "success", text: input };
  }

  if (typeof input === "object") {
    if (input.text) {
      const type =
        input.type === "error" || input.ok === false
          ? "error"
          : input.type === "warning"
            ? "warning"
            : "success";
      return { type, text: input.text };
    }
    if (input.message) {
      return {
        type: input.ok === false ? "error" : "success",
        text: input.message,
      };
    }
  }

  return null;
}

/**
 * Finance toasts via react-hot-toast (Toaster mounted in FinanceModuleShell).
 */
export default function useFinanceToast(durationMs = DEFAULT_DURATION_MS) {
  const showToast = useCallback(
    (input) => {
      const normalized = normalizeToast(input);
      if (!normalized?.text) return;

      const opts = { duration: durationMs };
      if (normalized.type === "error") {
        toast.error(normalized.text, opts);
      } else if (normalized.type === "warning") {
        toast(normalized.text, { ...opts, icon: "⚠️" });
      } else {
        toast.success(normalized.text, opts);
      }
    },
    [durationMs]
  );

  const clearToast = useCallback(() => {
    toast.dismiss();
  }, []);

  return { showToast, clearToast };
}
