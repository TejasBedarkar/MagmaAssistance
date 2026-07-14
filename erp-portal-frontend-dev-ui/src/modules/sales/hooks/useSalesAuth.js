import { useMemo } from "react";
import { useAuth as usePortalAuth } from "../../../common/context/AuthContext.jsx";
import {
  allowedActionsByRole,
  derivePrimaryRole,
  resolveRoleFromProfile,
} from "../lib/roles.js";

/**
 * Sales module auth — portal AuthContext + sales role resolution.
 * Session/login/logout use common AuthProvider; sales pages read user/roles here.
 */
export function useSalesAuth() {
  const portal = usePortalAuth();

  const salesRole = useMemo(() => {
    if (portal.roles?.length) {
      return derivePrimaryRole(portal.roles);
    }
    return resolveRoleFromProfile(portal.user);
  }, [portal.user, portal.roles]);

  const salesPermissions = useMemo(() => allowedActionsByRole(salesRole), [salesRole]);

  return {
    user: portal.user,
    fullName: portal.fullName,
    roles: portal.roles,
    loading: portal.loading,
    error: portal.error,
    isAdministrator: portal.isAdministrator,
    isManager: portal.isManager,
    login: portal.login,
    logout: portal.logout,
    refreshSession: portal.refreshSession,
    salesRole,
    salesPermissions,
  };
}

/** Alias for import parity with other modules */
export const useAuth = useSalesAuth;
