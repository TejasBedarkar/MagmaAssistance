/** Supply Chain module routes for Sales ↔ SCM linking (Phase A+). */

export const SCM_PRODUCTS_ROUTE = "/supply-chain/products";
export const SCM_INVENTORY_ROUTE = "/supply-chain/inventory";
export const SCM_MATERIAL_REQUESTS_ROUTE = "/supply-chain/material-requests";
export const SCM_RESERVATIONS_ROUTE = "/supply-chain/reservations";

/** Open SCM Products page with item detail deep link. */
export function scmProductLink(itemCode) {
  const code = String(itemCode || "").trim();
  if (!code) return SCM_PRODUCTS_ROUTE;
  return `${SCM_PRODUCTS_ROUTE}?item=${encodeURIComponent(code)}`;
}

/** Filter SCM Material Requests raised from a Sales Quotation. */
export function scmMaterialRequestsForQuotation(quotationName) {
  const name = String(quotationName || "").trim();
  if (!name) return SCM_MATERIAL_REQUESTS_ROUTE;
  const params = new URLSearchParams({ source: "Sales Quotation", source_name: name });
  return `${SCM_MATERIAL_REQUESTS_ROUTE}?${params}`;
}

/** Filter SCM reservations for a Sales Order. */
export function scmReservationsForSalesOrder(salesOrderName) {
  const name = String(salesOrderName || "").trim();
  if (!name) return SCM_RESERVATIONS_ROUTE;
  const params = new URLSearchParams({ source: "Sales Order", source_name: name });
  return `${SCM_RESERVATIONS_ROUTE}?${params}`;
}
