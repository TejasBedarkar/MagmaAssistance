import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import "../theme/supplyChain.css";

export default function SupplyChainModuleShell() {
  useEffect(() => {
    const main = document.querySelector(".pm-main");
    main?.classList.add("pm-main--supply-chain-module");
    return () => main?.classList.remove("pm-main--supply-chain-module");
  }, []);

  return (
    <div className="scm-module-root">
      <Toaster position="bottom-right" gutter={12} />
      <Outlet />
    </div>
  );
}
