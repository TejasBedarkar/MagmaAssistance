import { useCallback } from "react";
import toast from "react-hot-toast";
import { showPortalToast } from "../components/PortalToast.jsx";

/**
 * Portal-wide toast hook — use in any common or module page.
 * @example
 * const { showToast } = usePortalToast();
 * showToast("User saved", "success");
 * showToast("Could not save", "error");
 */
export default function usePortalToast(defaultDurationMs = 3600) {
  const showToast = useCallback(
    (message, type = "success", durationMs = defaultDurationMs) => {
      showPortalToast(message, type, durationMs);
    },
    [defaultDurationMs]
  );

  const dismissToast = useCallback(() => {
    toast.dismiss();
  }, []);

  return { showToast, dismissToast };
}
