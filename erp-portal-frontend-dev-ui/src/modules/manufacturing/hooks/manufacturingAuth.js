import { useAuth as usePortalAuth } from "../../../common/context/AuthContext.jsx";
import { useManufacturingSession } from "../context/ManufacturingSessionContext.jsx";

export { ROLES } from "../constants/roles.js";
export { default as RoleGate } from "../components/RoleGate.jsx";

/**
 * Manufacturing pages: portal session + role/lookups from ManufacturingSessionProvider.
 * Login/logout use common AuthContext (portal Login page).
 */
export function useManufacturingAuth() {
  const portal = usePortalAuth();
  const session = useManufacturingSession();

  return {
    ...session,
    fullName: portal.fullName,
    roles: portal.roles,
    isAdministrator: portal.isAdministrator,
    isManager: portal.isManager,
    isProgramManager: portal.isProgramManager,
    login: portal.login,
    logout: portal.logout,
    refreshSession: portal.refreshSession,
  };
}

/** @deprecated Use useManufacturingAuth — kept for import parity during refactor */
export const useAuth = useManufacturingAuth;
