import { useEffect } from "react";
import { Outlet } from "react-router-dom";

const PM_MAIN_SALES_CLASS = "pm-main--sales-module";

/** Wraps all integrated-portal sales routes — dark theme scopes to this root only. */
export default function SalesModuleShell() {
  useEffect(() => {
    const main = document.querySelector(".pm-main");
    main?.classList.add(PM_MAIN_SALES_CLASS);
    return () => main?.classList.remove(PM_MAIN_SALES_CLASS);
  }, []);

  return (
    <div className="sales-module-root">
      <Outlet />
    </div>
  );
}
