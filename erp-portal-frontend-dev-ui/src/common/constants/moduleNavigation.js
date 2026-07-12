/**
 * Per-module sidebar navigation for managers / administrators.
 * Delivery users only see project sections (see Layout + branding.js).
 */

/** @typedef {{ to: string, label: string, short?: string, end?: boolean, icon?: string, accent?: string }} NavItem */
/** @typedef {{ id: string, label: string, items: NavItem[] }} NavSection */

/** Portal admin — Users & Settings (not an ERP module). */
export const ADMIN_NAV_ITEMS = [
  { to: "/users", label: "Users", accent: "#60a5fa" },
  { to: "/settings", label: "Settings", accent: "#a78bfa" },
];

export function isAdminArea(pathname) {
  return /^\/(users|settings)(\/|$)/.test(pathname || "/");
}

/** Project Management — paths unchanged. */
export const PROJECT_NAV_SECTIONS = [
  {
    id: "overview",
    label: "Overview",
    items: [{ to: "/", label: "Dashboard", short: "Dashboard", end: true }],
  },
  {
    id: "portfolio",
    label: "Portfolio",
    items: [
      { to: "/projects", label: "Programs & Projects", short: "Projects" },
      { to: "/milestones", label: "Milestones", short: "Milestones" },
    ],
  },
  {
    id: "delivery",
    label: "Delivery",
    items: [
      { to: "/tasks", label: "Tasks", short: "Tasks" },
      { to: "/team", label: "Team & Assignments", short: "Team" },
    ],
  },
  {
    id: "resources",
    label: "Resources",
    items: [{ to: "/timesheets", label: "Timesheets", short: "Timesheets" }],
  },
];

/** Delivery team — My Day under Dashboard in sidebar. */
export const TEAM_PROJECT_NAV_SECTIONS = [
  {
    id: "overview",
    label: "Overview",
    items: [
      { to: "/", label: "Dashboard", short: "Dashboard", end: true },
      { to: "/my-day", label: "My Day", short: "My Day" },
    ],
  },
  ...PROJECT_NAV_SECTIONS.slice(1),
];

/** Business analyst — portfolio visibility without My Day or timesheets. */
export const BA_PROJECT_NAV_SECTIONS = [
  {
    id: "overview",
    label: "Overview",
    items: [{ to: "/", label: "Dashboard", short: "Dashboard", end: true }],
  },
  {
    id: "portfolio",
    label: "Portfolio",
    items: [
      { to: "/projects", label: "Programs & Projects", short: "Projects" },
      { to: "/milestones", label: "Milestones", short: "Milestones" },
    ],
  },
  {
    id: "analysis",
    label: "Analysis",
    items: [{ to: "/tasks", label: "Tasks", short: "Tasks" }],
  },
];

/**
 * Sales sidebar — top-to-bottom matches typical ERP flow:
 * Dashboard → pipeline → leads/deals → customers → documents → billing.
 */
export const SALES_NAV_SECTIONS = [
  {
    id: "overview",
    label: "Overview",
    items: [{ to: "/sales", label: "Dashboard", short: "Dashboard", end: true }],
  },
  {
    id: "pipeline",
    label: "Pipeline & CRM",
    items: [
      { to: "/sales/leads", label: "Leads", short: "Leads" },
      { to: "/sales/opportunities", label: "Opportunities", short: "Opportunities" },
      { to: "/sales/customers", label: "Customers", short: "Customers" },
      { to: "/sales/pipeline", label: "Delivery pipeline", short: "Pipeline" },
    ],
  },
  {
    id: "documents",
    label: "Sales documents",
    items: [
      { to: "/sales/list", label: "Sales list", short: "Sales list" },
      { to: "/sales/quotations", label: "Quotations", short: "Quotations" },
      { to: "/sales/orders", label: "Orders", short: "Orders" },
    ],
  },
  {
    id: "billing",
    label: "Billing",
    items: [
      { to: "/sales/invoices", label: "Invoices", short: "Invoices" },
      { to: "/sales/payments", label: "Payments", short: "Payments" },
    ],
  },
];

/** Finance sidebar — matches erp-portal/src/modules/finance/routes.jsx descriptions. */
export const FINANCE_NAV_SECTIONS = [
  {
    id: "main",
    label: "Main",
    items: [{ to: "/finance", label: "Dashboard", short: "Dashboard", end: true }],
  },
  {
    id: "sales_billing",
    label: "Sales & receivables",
    items: [
      { to: "/finance/sales-orders", label: "Sales orders", short: "SO" },
      { to: "/finance/delivery-notes", label: "Delivery notes", short: "DN" },
      { to: "/finance/sales-invoices", label: "Sales invoices", short: "SI" },
      { to: "/finance/credit-notes", label: "Credit Notes & Refunds", short: "CN" },
      { to: "/finance/customer-aging", label: "Customer aging", short: "Aging" },
    ],
  },
  {
    id: "purchases",
    label: "Purchases & payables",
    items: [
      { to: "/finance/purchase-orders", label: "Purchase orders", short: "PO" },
      { to: "/finance/purchase-receipts", label: "Purchase receipts", short: "PR" },
      { to: "/finance/purchase-invoices", label: "Purchase invoices", short: "PI" },
      { to: "/finance/supplier-aging", label: "Supplier aging", short: "Aging" },
    ],
  },
  {
    id: "banking",
    label: "Banking & payments",
    items: [
      { to: "/finance/bank-reconciliation", label: "Bank reconciliation", short: "Bank" },
      { to: "/finance/payment-entries", label: "Payment entries", short: "Payments" },
      { to: "/finance/pending-approvals", label: "Pending approvals", short: "Approve" },
    ],
  },
  {
    id: "ledger",
    label: "General ledger",
    items: [
      { to: "/finance/chart-of-accounts", label: "Chart of accounts", short: "COA" },
      { to: "/finance/journal-entries", label: "Journal entries", short: "Journal" },
      { to: "/finance/general-ledger", label: "General ledger", short: "GL" },
      { to: "/finance/trial-balance", label: "Trial balance", short: "TB" },
    ],
  },
  {
    id: "reports",
    label: "Reporting & compliance",
    items: [
      { to: "/finance/profit-and-loss", label: "Profit & loss", short: "P&L" },
      { to: "/finance/balance-sheet", label: "Balance sheet", short: "BS" },
      { to: "/finance/cash-flow", label: "Cash flow", short: "CF" },
      { to: "/finance/gst-tds", label: "GST & TDS", short: "GST" },
      { to: "/finance/budget", label: "Budget", short: "Budget" },
      { to: "/finance/fixed-assets", label: "Fixed assets", short: "Assets" },
    ],
  },
  {
    id: "setup",
    label: "Setup",
    items: [
      { to: "/finance/company-setup", label: "Company & fiscal year", short: "Setup" },
    ],
  },
];

/**
 * Manufacturing Operations — shop-floor flow (work order → dispatch → closure).
 * Paths are prefixed with /manufacturing so they do not conflict with Project Management (/).
 */
export const MANUFACTURING_NAV_SECTIONS = [
  {
    id: "overview",
    label: "Overview",
    items: [{ to: "/manufacturing", label: "Dashboard", short: "Dashboard", end: true }],
  },
  {
    id: "planning",
    label: "Planning & scheduling",
    items: [
      { to: "/manufacturing/work-orders", label: "Work Orders", short: "Work Orders" },
      { to: "/manufacturing/capacity", label: "Capacity Planning", short: "Capacity" },
      { to: "/manufacturing/materials", label: "Materials", short: "Materials" },
    ],
  },
  {
    id: "execution",
    label: "Shop floor",
    items: [
      { to: "/manufacturing/production", label: "Production", short: "Production" },
      { to: "/manufacturing/quality", label: "Quality", short: "Quality" },
      { to: "/manufacturing/maintenance", label: "Maintenance", short: "Maintenance" },
    ],
  },
  {
    id: "logistics",
    label: "Logistics & closure",
    items: [
      { to: "/manufacturing/dispatch", label: "Dispatch", short: "Dispatch" },
      { to: "/manufacturing/closure", label: "Closure", short: "Closure" },
    ],
  },
  {
    id: "reporting",
    label: "Reporting",
    items: [{ to: "/manufacturing/reports", label: "Reports", short: "Reports" }],
  },
  {
    id: "setup",
    label: "Setup & master data",
    items: [
      { to: "/manufacturing/qc-templates", label: "QC Templates", short: "QC Templates" },
      { to: "/manufacturing/workstations", label: "Workstations", short: "Workstations" },
    ],
  },
];

export const SUPPLY_CHAIN_NAV_SECTIONS = [
  {
    id: "overview",
    label: "Overview",
    items: [{ to: "/supply-chain", label: "Dashboard", short: "Dashboard", end: true }],
  },
  {
    id: "master_data",
    label: "Master data",
    items: [
      { to: "/supply-chain/products", label: "Products", short: "Products" },
      { to: "/supply-chain/bom", label: "BOM", short: "BOM" },
      { to: "/supply-chain/plant", label: "Plant", short: "Plant" },
      { to: "/supply-chain/warehouses", label: "Warehouses", short: "WH" },
      { to: "/supply-chain/suppliers", label: "Suppliers", short: "Suppliers" },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    items: [
      { to: "/supply-chain/inventory", label: "Stock", short: "Stock" },
      { to: "/supply-chain/stock-transfer", label: "Stock transfer", short: "Transfer" },
    ],
  },
  {
    id: "procurement",
    label: "Procurement",
    items: [
      { to: "/supply-chain/material-requests", label: "Material requests", short: "MR" },
      { to: "/supply-chain/rfq", label: "RFQ", short: "RFQ" },
      { to: "/supply-chain/purchase-orders", label: "Purchase orders", short: "POs" },
      { to: "/supply-chain/grn", label: "GRN", short: "GRN" },
    ],
  },
  {
    id: "planning",
    label: "Planning",
    items: [
      { to: "/supply-chain/mrp", label: "MRP planning", short: "MRP" },
      { to: "/supply-chain/reservations", label: "Reservations", short: "Res" },
    ],
  },
  {
    id: "returns",
    label: "Returns",
    items: [{ to: "/supply-chain/rma", label: "Returns (RMA)", short: "RMA" }],
  },
];

/** @type {Record<string, { id: string, label: string, home: string, match: RegExp, nav: NavSection[] }>} */
export const ERP_MODULES = {
  projects: {
    id: "projects",
    label: "Project Management",
    home: "/",
    match: /^\/($|projects|tasks|milestones|timesheets|team|my-day)(\/|$)/,
    nav: PROJECT_NAV_SECTIONS,
  },
  sales: {
    id: "sales",
    label: "Sales",
    home: "/sales",
    match: /^\/sales(\/|$)/,
    nav: SALES_NAV_SECTIONS,
  },
  finance: {
    id: "finance",
    label: "Finance",
    home: "/finance",
    match: /^\/finance(\/|$)/,
    nav: FINANCE_NAV_SECTIONS,
  },
  supply_chain: {
    id: "supply_chain",
    label: "Supply Chain",
    home: "/supply-chain",
    match: /^\/supply-chain(\/|$)/,
    nav: SUPPLY_CHAIN_NAV_SECTIONS,
  },
  manufacturing: {
    id: "manufacturing",
    label: "Manufacturing Operations",
    home: "/manufacturing",
    match: /^\/manufacturing(\/|$)/,
    nav: MANUFACTURING_NAV_SECTIONS,
  },
};

/** Top-level module switcher (managers / administrators). */
export const ERP_MODULE_LINKS = Object.values(ERP_MODULES).map((mod) => ({
  id: mod.id,
  to: mod.home,
  label: mod.label,
  end: true,
  match: mod.match,
}));

const MODULE_MATCH_ORDER = [
  "sales",
  "finance",
  "manufacturing",
  "supply_chain",
  "projects",
];

export function activeModuleId(pathname) {
  const path = pathname || "/";
  if (isAdminArea(path)) return null;
  for (const key of MODULE_MATCH_ORDER) {
    if (ERP_MODULES[key].match.test(path)) return key;
  }
  return "projects";
}

export function navSectionsForPath(pathname) {
  return ERP_MODULES[activeModuleId(pathname)].nav;
}

/** Module links for sidebar — excludes the module you are already in. */
export function sidebarModuleLinks(pathname) {
  const active = activeModuleId(pathname);
  return ERP_MODULE_LINKS.filter((link) => link.id !== active);
}

export function activeModuleLabel(pathname) {
  if (isAdminArea(pathname)) return "Administration";
  const id = activeModuleId(pathname);
  return ERP_MODULES[id || "projects"].label;
}

export function flatNavItems(sections) {
  return sections.flatMap((section) => section.items);
}

/** Route path segment(s) for react-router (no leading slash). */
export function routePathFromNavItem(item) {
  return item.to.replace(/^\//, "");
}
