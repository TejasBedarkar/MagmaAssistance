import { MFG_PRODUCT_DEV_DASHBOARD_REFRESH } from "../../manufacturing/utils/dashboardEvents.js";

export const SALES_PRODUCT_DEV_DASHBOARD_REFRESH = "sales-product-dev-dashboard-refresh";

/** Notify the Manufacturing dashboard to reload product-dev alert banners. */
export function notifyManufacturingDashboardRefresh() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MFG_PRODUCT_DEV_DASHBOARD_REFRESH));
  }
}

/** Notify the Sales dashboard to reload product-dev result banners. */
export function notifySalesDashboardRefresh() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SALES_PRODUCT_DEV_DASHBOARD_REFRESH));
  }
}
