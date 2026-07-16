import { Outlet } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import FinanceAccessGuard from "./FinanceAccessGuard.jsx";

const FINANCE_TOAST_OPTIONS = {
  duration: 4000,
  style: {
    background: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    fontSize: "12px",
    fontWeight: "600",
    lineHeight: "1.35",
    padding: "8px 14px",
    borderRadius: "var(--radius-sm, 8px)",
    boxShadow: "0 8px 28px rgba(0, 0, 0, 0.4)",
    maxWidth: "300px",
  },
  success: {
    iconTheme: { primary: "var(--success)", secondary: "var(--surface)" },
  },
  error: {
    iconTheme: { primary: "var(--danger)", secondary: "var(--surface)" },
  },
};

/** Wraps finance module routes — scopes finance UI under portal layout. */
export default function FinanceModuleShell() {
  return (
    <div className="finance-module-root">
      <Toaster position="bottom-right" gutter={12} toastOptions={FINANCE_TOAST_OPTIONS} />
      <FinanceAccessGuard>
        <Outlet />
      </FinanceAccessGuard>
    </div>
  );
}
