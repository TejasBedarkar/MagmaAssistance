/** Portal routes for SCM documents and cross-module deep links. */

const SCM_DOC_ROUTES = {
  "Material Request": (name) => `/supply-chain/material-requests?mr=${encodeURIComponent(name)}`,
  "Purchase Order": (name) => `/supply-chain/purchase-orders?po=${encodeURIComponent(name)}`,
  "Purchase Receipt": (name) => `/supply-chain/grn?grn=${encodeURIComponent(name)}`,
  "SCM RMA": (name) => `/supply-chain/rma?rma=${encodeURIComponent(name)}`,
  Item: (name) => `/supply-chain/products?item=${encodeURIComponent(name)}`,
};

const CROSS_MODULE_ROUTES = {
  "Sales Quotation": (name) => `/sales/quotations?q=${encodeURIComponent(name || "")}`,
  Opportunity: (name) => `/sales/opportunities?open=${encodeURIComponent(name || "")}`,
  "MFG Material Check": (name) =>
    name
      ? `/supply-chain/material-requests?source=${encodeURIComponent("MFG Material Check")}&source_name=${encodeURIComponent(name)}`
      : "/supply-chain/material-requests?source=MFG Material Check",
  "MFG Work Order": (name) => `/manufacturing/work-orders?q=${encodeURIComponent(name || "")}`,
};

export const MODULE_QUICK_LINKS = [
  { to: "/sales/quotations", label: "Sales quotations", module: "Sales", hint: "Shortage → MR" },
  { to: "/manufacturing/materials", label: "MFG materials", module: "Manufacturing", hint: "Material check" },
  { to: "/finance/purchase-invoices", label: "Purchase invoices", module: "Finance", hint: "GRN → billing" },
];

export function scmActivityLink(label, detail) {
  const name = label || "";
  const route = SCM_DOC_ROUTES[detail];
  return route ? route(name) : null;
}

export function scmMaterialRequestSourceFilter(sourceDoctype, sourceName) {
  const params = new URLSearchParams();
  if (sourceDoctype) params.set("source", sourceDoctype);
  if (sourceName) params.set("source_name", sourceName);
  const q = params.toString();
  return q ? `/supply-chain/material-requests?${q}` : "/supply-chain/material-requests";
}

export function parseSourceLink(source) {
  const text = String(source || "").trim();
  if (!text || text === "Manual") return null;
  const [doctype, ...rest] = text.split(" ");
  const name = rest.join(" ").trim();
  const cross = CROSS_MODULE_ROUTES[doctype];
  if (cross) return { to: cross(name), label: text };
  return null;
}

export function salesQuotationLink(reference) {
  if (!reference) return null;
  return `/sales/quotations?q=${encodeURIComponent(reference)}`;
}

/** SCM Products page with item detail deep link (Sales Opportunity Phase A). */
export function scmProductLink(itemCode) {
  const code = String(itemCode || "").trim();
  if (!code) return "/supply-chain/products";
  return `/supply-chain/products?item=${encodeURIComponent(code)}`;
}

export function salesOpportunityLink(opportunityId) {
  const name = String(opportunityId || "").trim();
  if (!name) return "/sales/opportunities";
  return `/sales/opportunities?open=${encodeURIComponent(name)}`;
}
