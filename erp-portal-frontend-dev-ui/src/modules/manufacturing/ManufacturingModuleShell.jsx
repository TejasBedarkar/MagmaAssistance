import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import ManufacturingAccessGuard from "./components/ManufacturingAccessGuard.jsx";

const PM_MAIN_MFG_CLASS = "pm-main--manufacturing-module";

/** Scopes manufacturing pages to portal main content (header bell is common Layout). */
export default function ManufacturingModuleShell() {
  useEffect(() => {
    const main = document.querySelector(".pm-main");
    main?.classList.add(PM_MAIN_MFG_CLASS);
    return () => main?.classList.remove(PM_MAIN_MFG_CLASS);
  }, []);

  return (
    <div className="manufacturing-module-root pm-page">
      <ManufacturingAccessGuard>
        <Outlet />
      </ManufacturingAccessGuard>
    </div>
  );
}
