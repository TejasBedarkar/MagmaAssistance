import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { isPortalAdministrator } from "../utils/portalAccess.js";

export default function PrivateRoute({ children, requireAdmin = false, redirectTo = "/" }) {
  const { user, roles, isAdministrator, loading } = useAuth();

  if (loading) {
    return (
      <div className="pm-empty" style={{ padding: 48, textAlign: "center", color: "var(--muted)" }}>
        Loading session…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requireAdmin && !isPortalAdministrator(roles, { isAdministrator, user })) {
    return <Navigate to={redirectTo} replace />;
  }

  return children;
}
