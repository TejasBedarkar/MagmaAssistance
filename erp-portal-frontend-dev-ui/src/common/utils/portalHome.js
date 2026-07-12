import { hasFinancePortalAccess } from "../../modules/finance/financeNav.js";
import { resolveManufacturingRole } from "../../modules/manufacturing/manufacturingNav.js";
import { hasScmPortalAccess, supplyChainPortalHomePath } from "../../modules/supply_chain/supplyChainNav.js";
import {
  hasPmPortalRole,
  isDeliveryMemberRole,
  isBusinessAnalystRole,
} from "../../modules/projects/lib/roles.js";

/** Portal-assigned sales roles (mirrors portalUserRoles.js + legacy ERPNext names). */
const SALES_PORTAL_ROLES = new Set([
  "Sales Executive",
  "Sales Manager",
  "Sales User",
  "Delivery Executive",
  "Delivery Manager",
  "Delivery User",
]);

export function hasSalesPortalRole(roles = []) {
  return (roles || []).some((r) => SALES_PORTAL_ROLES.has(String(r || "").trim()));
}

export function hasPmPortalAccess(roles = [], { isManager = false, isAdministrator = false } = {}) {
  if (isAdministrator || isManager) return true;
  return hasPmPortalRole(roles);
}

/** Build home-path options from get_session_info payload. */
export function portalHomeOptionsFromSession(session = {}) {
  const roles = session.roles || [];
  return {
    isManager: !!session.is_manager,
    isAdministrator:
      session.is_administrator != null
        ? !!session.is_administrator
        : roles.some((r) => ["Administrator", "System Manager"].includes(r)),
    isBusinessAnalyst: !!session.is_business_analyst,
    isDeliveryMember: !!session.is_delivery_member,
  };
}

/**
 * Default landing path after login (and for `/` index).
 * Returns `null` when the user has no module role (e.g. Desk User only).
 */
export function getPortalHomePath(roles = [], options = {}) {
  const {
    isManager = false,
    isAdministrator = false,
    isBusinessAnalyst = false,
    isDeliveryMember = false,
  } = options;

  if (isAdministrator || isManager) {
    return "/";
  }
  if (resolveManufacturingRole(roles)) {
    return "/manufacturing";
  }
  if (hasFinancePortalAccess(roles)) {
    return "/finance";
  }
  if (hasSalesPortalRole(roles)) {
    return "/sales";
  }
  if (hasScmPortalAccess(roles, { isManager, isAdministrator })) {
    return supplyChainPortalHomePath();
  }
  if (hasPmPortalAccess(roles, { isManager, isAdministrator })) {
    const roleList = roles || [];
    const ba = isBusinessAnalyst || isBusinessAnalystRole(roleList);
    const delivery =
      isDeliveryMember || (isDeliveryMemberRole(roleList) && !roleList.includes("Project Manager"));

    if (ba) return "/";
    if (delivery) return "/";
    return "/";
  }
  return null;
}
