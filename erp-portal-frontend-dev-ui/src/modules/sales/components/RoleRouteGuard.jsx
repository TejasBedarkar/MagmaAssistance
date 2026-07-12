import { hasSalesRoleAccess } from "../lib/roles.js";
import { useSalesAuth } from "../hooks/useSalesAuth.js";
import AccessDeniedState from "./AccessDeniedState";
import SalesPageLoader from "./SalesPageLoader.jsx";

export default function RoleRouteGuard({ allow = [], children }) {
  const { user, roles, salesRole, loading } = useSalesAuth();

  if (loading) {
    return (
      <div className="pm-page sales-route-guard-loading">
        <SalesPageLoader label="Checking access…" />
      </div>
    );
  }
  if (hasSalesRoleAccess(roles, salesRole, allow)) return children;
  return (
    <AccessDeniedState
      detail={`Signed in as ${user || "user"} with role "${salesRole}". This route is not available for your role.`}
    />
  );
}
