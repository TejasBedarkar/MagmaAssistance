/**
 * Role-filtered finance sidebar — mirrors manufacturingNav.js pattern.
 */
import { FINANCE_NAV_SECTIONS } from "../../common/constants/moduleNavigation.js";
import { FINANCE_REPORT_ROLES, FINANCE_ROLE, isFullFinanceAccessRole } from "./lib/roles.js";

const SECTION_ORDER = [
  "main",
  "sales_billing",
  "purchases",
  "banking",
  "ledger",
  "reports",
  "setup",
];

const AR_ROLES = [FINANCE_ROLE.AR_EXEC, FINANCE_ROLE.FINANCE_MANAGER, FINANCE_ROLE.CFO];
const AP_ROLES = [FINANCE_ROLE.AP_EXEC, FINANCE_ROLE.FINANCE_MANAGER, FINANCE_ROLE.CFO];
const TREASURY_ROLES = [FINANCE_ROLE.TREASURY_MANAGER, FINANCE_ROLE.FINANCE_MANAGER, FINANCE_ROLE.CFO];
const LEDGER_ROLES = [FINANCE_ROLE.FINANCE_MANAGER, FINANCE_ROLE.CFO, FINANCE_ROLE.AUDITOR];
const REPORT_ROLES = FINANCE_REPORT_ROLES;
const SETUP_ROLES = [FINANCE_ROLE.FINANCE_MANAGER, FINANCE_ROLE.CFO];

/** Path → roles allowed (Finance Manager / CFO see all via isFullFinanceAccessRole). */
const PATH_ROLES = {
  "/finance": "all",
  "/finance/sales-orders": AR_ROLES,
  "/finance/delivery-notes": AR_ROLES,
  "/finance/eway-bills": AR_ROLES,
  "/finance/sales-invoices": AR_ROLES,
  "/finance/credit-notes": AR_ROLES,
  "/finance/customer-aging": AR_ROLES,
  "/finance/purchase-orders": AP_ROLES,
  "/finance/purchase-receipts": AP_ROLES,
  "/finance/purchase-invoices": AP_ROLES,
  "/finance/supplier-aging": AP_ROLES,
  "/finance/bank-reconciliation": TREASURY_ROLES,
  "/finance/payment-entries": [...TREASURY_ROLES, FINANCE_ROLE.AR_EXEC, FINANCE_ROLE.AP_EXEC],
  "/finance/pending-approvals": [FINANCE_ROLE.CFO, FINANCE_ROLE.FINANCE_MANAGER],
  "/finance/chart-of-accounts": LEDGER_ROLES,
  "/finance/journal-entries": [FINANCE_ROLE.FINANCE_MANAGER, FINANCE_ROLE.CFO],
  "/finance/general-ledger": LEDGER_ROLES,
  "/finance/trial-balance": LEDGER_ROLES,
  "/finance/profit-and-loss": REPORT_ROLES,
  "/finance/balance-sheet": REPORT_ROLES,
  "/finance/cash-flow": REPORT_ROLES,
  "/finance/gst-tds": REPORT_ROLES,
  "/finance/budget": [FINANCE_ROLE.CFO, FINANCE_ROLE.FINANCE_MANAGER],
  "/finance/fixed-assets": [FINANCE_ROLE.FINANCE_MANAGER, FINANCE_ROLE.CFO],
  "/finance/company-setup": SETUP_ROLES,
};

function pathAllowed(path, financeRole) {
  if (!financeRole) return false;
  if (isFullFinanceAccessRole(financeRole)) return true;
  const allowed = PATH_ROLES[path];
  if (allowed === "all") return true;
  if (!allowed) return false;
  return allowed.includes(financeRole);
}

function filterSectionItems(section, financeRole) {
  const items = (section.items || []).filter((item) => pathAllowed(item.to, financeRole));
  if (!items.length) return null;
  return { ...section, items };
}

/**
 * Sidebar sections for portal Layout (SidebarProjectNav shape).
 * @param {string | null} financeRole
 */
export function getFinanceNavSections(financeRole) {
  if (!financeRole) return [];

  if (isFullFinanceAccessRole(financeRole)) {
    return FINANCE_NAV_SECTIONS;
  }

  return SECTION_ORDER.map((id) => FINANCE_NAV_SECTIONS.find((s) => s.id === id))
    .filter(Boolean)
    .map((section) => filterSectionItems(section, financeRole))
    .filter(Boolean);
}

export function getAllowedFinancePaths(financeRole) {
  if (!financeRole) return [];
  if (isFullFinanceAccessRole(financeRole)) {
    return Object.keys(PATH_ROLES);
  }
  return Object.keys(PATH_ROLES).filter((path) => pathAllowed(path, financeRole));
}

/**
 * @param {string} pathname
 * @param {string | null} financeRole
 */
function normalizeFinancePath(pathname) {
  return (pathname || "").replace(/\/$/, "") || "/finance";
}

export function isFinancePathAllowed(pathname, financeRole) {
  const path = normalizeFinancePath(pathname);
  if (!path.startsWith("/finance")) return true;
  if (!financeRole) return false;
  if (isFullFinanceAccessRole(financeRole)) return true;

  if (Object.prototype.hasOwnProperty.call(PATH_ROLES, path)) {
    return pathAllowed(path, financeRole);
  }

  const allowed = getAllowedFinancePaths(financeRole);
  return allowed.some((base) => {
    const b = normalizeFinancePath(base);
    if (b === "/finance") return path === "/finance";
    if (path === b) return true;
    return path.startsWith(`${b}/`);
  });
}

export { resolveFinanceRole, hasFinancePortalAccess } from "./lib/roles.js";
