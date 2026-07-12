import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/manufacturingAuth";
import { PageLoader } from "@/components/MfgPageLoader";
import { isManufacturingPathAllowed } from "../manufacturingNav.js";
import { mfgPath } from "../paths.js";

/**
 * Blocks /manufacturing URLs that are not allowed for the user's manufacturing role.
 * Uses manufacturing roles only — not project isManager / isProgramManager.
 */
export default function ManufacturingAccessGuard({ children }) {
  const { role, loading, isAuthenticated } = useAuth();
  const { pathname } = useLocation();

  if (loading) {
    return (
      <PageLoader label="Loading manufacturing…" className="mfg-access-loading" />
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (!role) {
    return <Navigate to="/" replace />;
  }

  if (!isManufacturingPathAllowed(pathname, role)) {
    return <Navigate to={mfgPath()} replace />;
  }

  return children;
}
