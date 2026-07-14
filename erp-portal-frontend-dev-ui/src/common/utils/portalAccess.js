import { hasFinancePortalAccess, resolveFinanceRole } from "../../modules/finance/financeNav.js";
import { resolveManufacturingRole } from "../../modules/manufacturing/manufacturingNav.js";
import { hasScmPortalAccess } from "../../modules/supply_chain/supplyChainNav.js";
import { derivePrimaryRole } from "../../modules/sales/portalSidebar.js";
import { hasSalesPortalRole } from "./portalHome.js";

const ADMIN_ROLES = new Set(["Administrator", "System Manager"]);

/** Portal header label for sales module roles (Frappe names → display). */
const SALES_ROLE_DISPLAY = {
  "Sales Executive": "Sales User",
  "Sales Manager": "Sales Manager",
  "Delivery Executive": "Delivery Executive",
  "Delivery Manager": "Delivery Manager",
};

export function isPortalAdministrator(roles = [], { isAdministrator = false, user = null } = {}) {
  if (isAdministrator) return true;
  if (user === "Administrator") return true;
  return (roles || []).some((role) => ADMIN_ROLES.has(role));
}

/** Manufacturing-role user without ERP administrator access (sidebar + routes scoped). */
export function isManufacturingOnlyPortalUser(roles = [], options = {}) {
  if (isPortalAdministrator(roles, options)) return false;
  return !!resolveManufacturingRole(roles);
}

/** Finance-role user without full ERP administrator module switcher. */
export function isFinanceOnlyPortalUser(roles = [], options = {}) {
  if (isPortalAdministrator(roles, options)) return false;
  return hasFinancePortalAccess(roles);
}

/** Supply-chain-role user scoped to SCM module only. */
export function isScmOnlyPortalUser(roles = [], options = {}) {
  if (isPortalAdministrator(roles, options)) return false;
  if (resolveManufacturingRole(roles)) return false;
  if (hasFinancePortalAccess(roles)) return false;
  if (hasSalesPortalRole(roles)) return false;
  return hasScmPortalAccess(roles, options);
}

export function financePortalHomePath() {
  return "/finance";
}

export function manufacturingPortalHomePath() {
  return "/manufacturing";
}

/** Block manufacturing-only users from opening other ERP modules via URL. */
export function isPathAllowedForPortalUser(pathname, roles = [], options = {}) {
  const path = (pathname || "").replace(/\/$/, "") || "/";
  if (path === "/login") return true;

  if (isManufacturingOnlyPortalUser(roles, options)) {
    if (path === "/" || path === "") return true;
    if (
      (path.startsWith("/users") || path.startsWith("/settings")) &&
      isPortalAdministrator(roles, options)
    ) {
      return true;
    }
    return path.startsWith("/manufacturing");
  }

  if (isFinanceOnlyPortalUser(roles, options)) {
    if (path === "/" || path === "") return true;
    return path.startsWith("/finance");
  }

  if (hasSalesPortalRole(roles) && !isPortalAdministrator(roles, options)) {
    if (path === "/" || path === "") return true;
    if (
      (path.startsWith("/users") || path.startsWith("/settings")) &&
      isPortalAdministrator(roles, options)
    ) {
      return true;
    }
    return path.startsWith("/sales");
  }

  if (isScmOnlyPortalUser(roles, options)) {
    if (path === "/" || path === "") return true;
    return path.startsWith("/supply-chain");
  }

  return true;
}

export function portalUserRoleLabel({
  roles = [],
  isManager = false,
  isAdministrator = false,
  user = null,
  mfgRole = null,
  financeRole = null,
  isDeveloper = false,
  isTester = false,
  isBusinessAnalyst = false,
  roleLabelFn,
}) {
  if (isPortalAdministrator(roles, { isAdministrator, user })) {
    return roleLabelFn(isManager, user, true, {
      isDeveloper,
      isTester,
      isBusinessAnalyst,
    });
  }
  if (financeRole) {
    return financeRole;
  }
  if (hasSalesPortalRole(roles)) {
    const key = derivePrimaryRole(roles);
    return SALES_ROLE_DISPLAY[key] || key;
  }
  return (
    mfgRole ||
    roleLabelFn(isManager, user, isAdministrator, {
      isDeveloper,
      isTester,
      isBusinessAnalyst,
    })
  );
}
