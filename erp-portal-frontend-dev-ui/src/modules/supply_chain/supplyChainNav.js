/**
 * Supply Chain portal sidebar + access — mirrors financeNav / manufacturingNav pattern.
 */
import { SUPPLY_CHAIN_NAV_SECTIONS } from "../../common/constants/moduleNavigation.js";
import { isPortalAdministrator } from "../../common/utils/portalAccess.js";

/** Roles allowed to read SCM APIs (mirrors supply_chain_app.api.permissions.SCM_READ_ROLES). */
export const SCM_PORTAL_ROLES = new Set([
  "System Manager",
  "Administrator",
  "Stock Manager",
  "Stock User",
  "Purchase Manager",
  "Purchase User",
  "Sales Manager",
  "Sales User",
  "SCM Manager",
  "SCM Executive",
]);

export function hasScmPortalAccess(roles = [], options = {}) {
  const { user = null, isAdministrator = false } = options;
  if (isPortalAdministrator(roles, { isAdministrator, user })) {
    return true;
  }
  return (roles || []).some((role) => SCM_PORTAL_ROLES.has(String(role || "").trim()));
}

export function getSupplyChainNavSections() {
  return SUPPLY_CHAIN_NAV_SECTIONS.map((section) => {
    if (section.id !== "planning") {
      return section;
    }
    const hasCapacity = section.items.some((item) => item.to === "/supply-chain/capacity-planning");
    if (hasCapacity) {
      return section;
    }
    return {
      ...section,
      items: [
        ...section.items,
        {
          to: "/supply-chain/capacity-planning",
          label: "Capacity planning",
          short: "Capacity",
        },
      ],
    };
  });
}

export function supplyChainPortalHomePath() {
  return "/supply-chain";
}
