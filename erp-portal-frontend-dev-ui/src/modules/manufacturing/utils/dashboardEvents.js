/** Cross-module event: Sales product-dev request should refresh the MFG dashboard banner. */
export const MFG_PRODUCT_DEV_DASHBOARD_REFRESH = "mfg-product-dev-dashboard-refresh";

export function dispatchManufacturingDashboardRefresh() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MFG_PRODUCT_DEV_DASHBOARD_REFRESH));
  }
}
