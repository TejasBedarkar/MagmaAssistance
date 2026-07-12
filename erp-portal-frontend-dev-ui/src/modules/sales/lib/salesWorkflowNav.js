/** Sales module workflow — ends at Sales Order (fulfillment & billing are separate in Finance). */
export const SALES_WORKFLOW_STAGES = [
  "Lead",
  "Opportunity",
  "Quotation",
  "Sales Order",
];

/** Finance module paths for linked documents shown in sales document trails. */
export const FINANCE_DOC_TRAIL_ROUTES = {
  "Delivery Note": "/finance/delivery-notes",
  "Sales Invoice": "/finance/sales-invoices",
};

export const FINANCE_SALES_ORDER_ROUTE = "/finance/sales-orders";

export function financeSalesOrderPath(salesOrderName) {
  const name = String(salesOrderName || "").trim();
  return name ? `${FINANCE_SALES_ORDER_ROUTE}?open=${encodeURIComponent(name)}` : FINANCE_SALES_ORDER_ROUTE;
}

export function financeDeliveryNotePath() {
  return FINANCE_DOC_TRAIL_ROUTES["Delivery Note"];
}

/** Manufacturing Work Order detail path (Sales → MFG handoff). */
export const MANUFACTURING_WORK_ORDER_ROUTE = "/manufacturing/work-orders";

export function manufacturingWorkOrderPath(workOrderName) {
  const name = String(workOrderName || "").trim();
  return name ? `${MANUFACTURING_WORK_ORDER_ROUTE}/${encodeURIComponent(name)}` : "";
}

/** Success toast after Sales Order create (quotation / opportunity / new order). */
export const SALES_ORDER_CREATED_TOAST = "Sales order created";

export function salesOrderCreatedToast() {
  return SALES_ORDER_CREATED_TOAST;
}

/** @deprecated Use salesOrderCreatedToast() — kept for existing imports during rollout. */
export function appendWorkOrderCreateToast() {
  return salesOrderCreatedToast();
}

/** Stage label → React Router path under /sales. */
export const SALES_WORKFLOW_STAGE_ROUTES = {
  Lead: "/sales/leads",
  Opportunity: "/sales/opportunities",
  Quotation: "/sales/quotations",
  "Sales Order": "/sales/orders",
};

/** Workflow stage → portal sidebar id (see SALES_ROLE_SIDEBAR). */
export const SALES_WORKFLOW_STAGE_NAV_ID = {
  Lead: "leads",
  Opportunity: "opportunities",
  Quotation: "quotations",
  "Sales Order": "orders",
};

/** Limit workflow pills to modules the role can open in the sidebar. */
export function workflowStagesForNavIds(allowedNavIds = []) {
  const allowed = new Set(allowedNavIds);
  return SALES_WORKFLOW_STAGES.filter((stage) =>
    allowed.has(SALES_WORKFLOW_STAGE_NAV_ID[stage])
  );
}

/** Infer active workflow stage from the current sales route. */
export function workflowStageFromPath(pathname = "") {
  const path = String(pathname || "");
  if (path.includes("/sales/orders")) return "Sales Order";
  if (path.includes("/sales/quotations")) return "Quotation";
  if (path.includes("/sales/opportunities")) return "Opportunity";
  if (path.includes("/sales/leads")) return "Lead";
  return "";
}
