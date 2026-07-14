import { Outlet } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { ManufacturingSessionProvider } from "./context/ManufacturingSessionContext.jsx";
import "./index.css";

const TOAST_OPTIONS = {
  duration: 4000,
  style: {
    background: "var(--surface-2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
  },
  success: { iconTheme: { primary: "var(--success)", secondary: "var(--surface-2)" } },
  error: { iconTheme: { primary: "var(--danger)", secondary: "var(--surface-2)" } },
};

/** Manufacturing session (role + lookups) + toasts; auth from portal common/AuthContext. */
export default function ManufacturingProviders() {
  return (
    <ManufacturingSessionProvider>
      <Toaster position="bottom-right" toastOptions={TOAST_OPTIONS} />
      <Outlet />
    </ManufacturingSessionProvider>
  );
}
