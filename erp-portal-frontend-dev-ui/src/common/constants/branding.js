/** ERP Portal — shared branding and navigation */

import {
  PROJECT_NAV_SECTIONS,
  TEAM_PROJECT_NAV_SECTIONS,
  activeModuleId,
  navSectionsForPath,
} from "./moduleNavigation.js";

export {
  navSectionsForPath,
  activeModuleId,
  activeModuleLabel,
  ERP_MODULE_LINKS,
  sidebarModuleLinks,
} from "./moduleNavigation.js";

export const BRAND = {
  company: "Magna Data",
  product: "ERP Portal",
  logoUrl: "/magna-data-logo.png",
  logoAlt: "Magna Data",
  tagline: "Projects · Sales · Finance · Manufacturing · Supply chain",
  short: "ERP",
};

/** Project Management sidebar for delivery users. */
export const NAV_SECTIONS = TEAM_PROJECT_NAV_SECTIONS;

export const NAV_ITEMS = NAV_SECTIONS.flatMap((section) => section.items);

const ROUTE_PAGE_TITLES = [
  [/^\/$/, "Dashboard"],
  [/^\/projects\/new$/, "New project"],
  [/^\/projects\/[^/]+\/delivery$/, "Delivery plan"],
  [/^\/projects\/[^/]+$/, "Project"],
  [/^\/projects$/, "Projects"],
  [/^\/milestones\/new$/, "New milestone"],
  [/^\/milestones\/[^/]+$/, "Milestone"],
  [/^\/milestones$/, "Milestones"],
  [/^\/my-day$/, "My Day"],
  [/^\/tasks\/new$/, "New task"],
  [/^\/tasks\/board$/, "Task board"],
  [/^\/tasks\/calendar$/, "Task calendar"],
  [/^\/tasks\/[^/]+$/, "Task"],
  [/^\/tasks$/, "Tasks"],
  [/^\/team$/, "Team"],
  [/^\/timesheets\/new$/, "New timesheet"],
  [/^\/timesheets\/[^/]+$/, "Timesheet"],
  [/^\/timesheets$/, "Timesheets"],
  [/^\/sales\/pipeline/, "Delivery pipeline"],
  [/^\/sales\/list/, "Sales list"],
  [/^\/sales\/customers/, "Customers"],
  [/^\/sales\/leads/, "Leads"],
  [/^\/sales\/opportunities/, "Opportunities"],
  [/^\/sales\/quotations/, "Quotations"],
  [/^\/sales\/orders/, "Orders"],
  [/^\/sales\/invoices/, "Invoices"],
  [/^\/sales\/payments/, "Payments"],
  [/^\/sales$/, "Sales"],
  [/^\/finance\/sales-orders/, "Sales Order"],
  [/^\/finance\/delivery-notes/, "Delivery Note"],
  [/^\/finance\/sales-invoices/, "Sales Invoice"],
  [/^\/finance\/customer-aging/, "Customer Aging"],
  [/^\/finance\/purchase-orders/, "Purchase Order"],
  [/^\/finance\/purchase-receipts/, "Purchase Receipt"],
  [/^\/finance\/purchase-invoices/, "Purchase Invoice"],
  [/^\/finance\/supplier-aging/, "Supplier Aging"],
  [/^\/finance\/bank-reconciliation/, "Bank Reconciliation"],
  [/^\/finance\/payment-entries/, "Payment Entry"],
  [/^\/finance\/journal-entries/, "Journal Entry"],
  [/^\/finance\/chart-of-accounts/, "Chart of Accounts"],
  [/^\/finance\/general-ledger/, "General Ledger"],
  [/^\/finance\/trial-balance/, "Trial Balance"],
  [/^\/finance\/profit-and-loss/, "Profit & Loss"],
  [/^\/finance\/balance-sheet/, "Balance Sheet"],
  [/^\/finance\/cash-flow/, "Cash Flow Statement"],
  [/^\/finance\/gst-tds/, "GST / TDS (India)"],
  [/^\/finance\/budget/, "Budget"],
  [/^\/finance\/fixed-assets/, "Fixed Assets"],
  [/^\/finance\/company-setup/, "Company & Fiscal Year"],
  [/^\/finance$/, "Finance"],
  [/^\/supply-chain\/products/, "Products"],
  [/^\/supply-chain\/bom/, "BOM"],
  [/^\/supply-chain\/plant/, "Plant master"],
  [/^\/supply-chain\/warehouses/, "Warehouses"],
  [/^\/supply-chain\/suppliers/, "Suppliers"],
  [/^\/supply-chain\/inventory/, "Stock"],
  [/^\/supply-chain\/stock-transfer/, "Stock transfer"],
  [/^\/supply-chain\/material-requests/, "Material requests"],
  [/^\/supply-chain\/rfq/, "RFQ"],
  [/^\/supply-chain\/reservations/, "Reservations"],
  [/^\/supply-chain\/purchase-orders/, "Purchase orders"],
  [/^\/supply-chain\/grn/, "GRN"],
  [/^\/supply-chain\/mrp/, "MRP planning"],
  [/^\/supply-chain\/rma/, "Returns (RMA)"],
  [/^\/supply-chain$/, "Supply Chain"],
  [/^\/manufacturing\/work-orders/, "Work Orders"],
  [/^\/manufacturing\/capacity/, "Capacity Planning"],
  [/^\/manufacturing\/materials/, "Materials"],
  [/^\/manufacturing\/production/, "Production"],
  [/^\/manufacturing\/quality/, "Quality"],
  [/^\/manufacturing\/maintenance/, "Maintenance"],
  [/^\/manufacturing\/dispatch/, "Dispatch"],
  [/^\/manufacturing\/closure/, "Closure"],
  [/^\/manufacturing\/reports/, "Reports"],
  [/^\/manufacturing\/qc-templates/, "QC Templates"],
  [/^\/manufacturing\/workstations/, "Workstations"],
  [/^\/manufacturing$/, "Manufacturing Operations"],
  [/^\/users$/, "Users"],
  [/^\/settings$/, "Settings"],
];

export const PAGES = {
  dashboard: {
    title: "Executive Dashboard",
    description: "Portfolio performance, SLA compliance, and delivery health",
  },
  projects: {
    title: "Programs & Projects",
    description: "Portfolio records, budgets, and program ownership",
  },
  projectNew: {
    title: "New Program / Project",
    description: "Register a new initiative in the portfolio",
  },
  milestones: {
    title: "Program Milestones",
    description: "Key delivery gates and schedule commitments",
  },
  milestoneNew: {
    title: "New Program Milestone",
    description: "Define a delivery gate for a program",
  },
  tasks: {
    title: "Delivery Tasks",
    description: "Work breakdown items assigned across programs",
  },
  taskNew: {
    title: "New Delivery Task",
    description: "Create and assign work under a program",
  },
  team: {
    title: "Team & Assignments",
    description: "Delivery teams and task ownership across programs",
  },
  timesheets: {
    title: "Resource Timesheets",
    description: "Effort capture, approval workflow, and labour costing",
  },
  timesheetNew: {
    title: "New Timesheet Entry",
    description: "Log effort against a program and task",
  },
  login: {
    title: "Sign in",
    description: "",
  },
  myDay: {
    title: "My Day",
    description: "Personal workbench — priorities, quick actions, and time logging",
  },
  users: {
    title: "Users",
    description: "Manage portal login accounts and roles",
  },
  settings: {
    title: "Settings",
    description: "Portal and company configuration",
  },
};

export function roleLabel(isManager, user, isAdministrator = false, pmRole = {}) {
  if (isAdministrator || user === "Administrator") return "Administrator";
  if (isManager) return "Program Manager";
  if (pmRole.isBusinessAnalyst) return "Business Analyst";
  if (pmRole.isTester) return "Tester";
  if (pmRole.isDeveloper) return "Developer";
  return "Delivery Team";
}

export function isProjectsArea(pathname) {
  return activeModuleId(pathname) === "projects";
}

export function pageTitleFromPath(pathname) {
  const path = pathname || "/";
  for (const [pattern, title] of ROUTE_PAGE_TITLES) {
    if (pattern.test(path)) return title;
  }
  return "ERP Portal";
}
