/**
 * Sales module — portal sidebar visibility (ERP Portal shared Layout).
 * Program managers see Project Management + Sales; administrators see all modules.
 * Users with only a manufacturing role see the Manufacturing module.
 */
import { ERP_MODULES } from "../../common/constants/moduleNavigation.js";

import { resolveManufacturingRole } from "../manufacturing/manufacturingNav.js";
import {
  ROLE,
  SALES_PORTAL_FRAPPE_ROLES,
  SALES_ROLE_SIDEBAR,
  derivePrimaryRole,
} from "./lib/roles.js";

export { derivePrimaryRole, SALES_ROLE_SIDEBAR };

/** Full ERP portal module order (must match SidebarAccordionNav MODULE_ORDER). */
export const ALL_PORTAL_MODULE_IDS = [
  "projects",
  "sales",
  "finance",
  "manufacturing",
  "supply_chain",
];

/** Shown when showErpModules is false; force role users into Sales module. */
export const MANAGER_PORTAL_MODULE_IDS = ["sales"];

/**
 * @param {boolean} showErpModules — from portal Layout (isAdministrator); often false when API omits is_administrator
 * @param {string[]} [portalRoles] — Frappe roles from common AuthContext (see hooks/useSalesAuth.js)
 * @returns {string[] | null} null = use full MODULE_ORDER in SidebarAccordionNav
 */
export function sidebarModuleIdsForPortal(showErpModules, portalRoles = []) {
  if (showErpModules) {
    return null;
  }
  if (resolveManufacturingRole(portalRoles)) {
    return ["manufacturing"];
  }
  return MANAGER_PORTAL_MODULE_IDS;
}

export function filterSalesSidebarByRole(items, role) {
  const allowed =
    SALES_ROLE_SIDEBAR[String(role || "Sales Executive")] || SALES_ROLE_SIDEBAR["Sales Executive"];
  return (Array.isArray(items) ? items : []).filter((item) => allowed.includes(item?.page || item?.id));
}

const SALES_NAV_SECTIONS_META = [
  { id: "overview", label: "Overview" },
  { id: "pipeline", label: "Pipeline & CRM" },
  { id: "documents", label: "Sales documents" },
];

const SALES_NAV_ITEMS = [
  { id: "dashboard", section: "overview", to: "/sales", label: "Dashboard", short: "Dashboard", end: true },
  { id: "leads", section: "pipeline", to: "/sales/leads", label: "Leads", short: "Leads" },
  { id: "opportunities", section: "pipeline", to: "/sales/opportunities", label: "Opportunities", short: "Opportunities" },
  { id: "customers", section: "pipeline", to: "/sales/customers", label: "Customers", short: "Customers" },
  { id: "pipeline", section: "pipeline", to: "/sales/pipeline", label: "Sales pipeline", short: "Pipeline" },
  { id: "sales_list", section: "documents", to: "/sales/list", label: "Sales list", short: "Sales list" },
  { id: "quotations", section: "documents", to: "/sales/quotations", label: "Quotations", short: "Quotations" },
  { id: "pending_approvals", section: "documents", to: "/sales/pending-approvals", label: "Pending approvals", short: "Approvals" },
  { id: "orders", section: "documents", to: "/sales/orders", label: "Orders", short: "Orders" },
  { id: "returns", section: "documents", to: "/sales/returns", label: "Returns (RMA)", short: "Returns" },
  { id: "audit_logs", section: "documents", to: "/sales/audit-logs", label: "Audit logs", short: "Audit" },
];

export function buildSalesNavForRole(role) {
  const roleKey = String(role || "Sales Executive");
  const allowed = new Set(SALES_ROLE_SIDEBAR[roleKey] || SALES_ROLE_SIDEBAR["Sales Executive"]);

  const sectionItems = SALES_NAV_SECTIONS_META.map((section) => ({
    id: section.id,
    label: section.label,
    items: SALES_NAV_ITEMS
      .filter((item) => item.section === section.id && allowed.has(item.id))
      .map(({ to, label, short, end }) => ({ to, label, short, end })),
  })).filter((section) => section.items.length > 0);

  return sectionItems;
}

/** Role-filtered sales sidebar for Layout (React-driven; do not rely on ERP_MODULES mutation). */
export function buildSalesNavForPortalRoles(portalRoles = []) {
  return buildSalesNavForRole(derivePrimaryRole(portalRoles));
}

function applySalesNavForRole(role) {
  const salesModule = ERP_MODULES?.sales;
  if (!salesModule) return;
  salesModule.nav = buildSalesNavForRole(role);
}

/** Override common SALES_NAV_SECTIONS — sales nav lives in this module only. */
function installSalesErpModuleNav() {
  applySalesNavForRole(ROLE.SYSTEM_MANAGER);
}

installSalesErpModuleNav();

/**
 * Frontend-only bridge:
 * Project shell marks sidebar type from `is_manager` in session info.
 * For sales roles, force manager-nav so users see ERP modules (including Sales) instead of PM-only nav.
 */
function patchSessionInfoFetchForSalesRoles() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  if (window.__salesSessionInfoPatchInstalled) return;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await nativeFetch(...args);
    const reqUrl = String(args?.[0]?.url || args?.[0] || "");
    if (!reqUrl.includes("/api/method/project_management.api.get_session_info")) {
      return res;
    }
    try {
      const body = await res.clone().json();
      const msg = body?.message;
      const roles = Array.isArray(msg?.roles) ? msg.roles : [];
      applySalesNavForRole(derivePrimaryRole(roles));
      const hasSalesRole = roles.some((r) => SALES_PORTAL_FRAPPE_ROLES.has(String(r || "").trim()));
      if (!msg || msg.is_manager || !hasSalesRole) {
        return res;
      }
      const patched = {
        ...body,
        message: {
          ...msg,
          is_manager: true,
        },
      };
      return new Response(JSON.stringify(patched), {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    } catch {
      return res;
    }
  };

  window.__salesSessionInfoPatchInstalled = true;
}

patchSessionInfoFetchForSalesRoles();
