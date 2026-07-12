import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { getPortalHomePath, portalHomeOptionsFromSession } from "../utils/portalHome.js";
import Dashboard from "../../modules/projects/pages/Dashboard.jsx";
import NoPortalAccess from "./NoPortalAccess.jsx";
import { PortalPageLoader } from "./PortalSpinner.jsx";

/**
 * `/` index — route users to their module home (sales, finance, mfg, PM).
 */
export default function PortalHomeRedirect() {
  const auth = useAuth();
  const { roles, loading } = auth;

  if (loading) {
    return <PortalPageLoader message="Loading portal…" minHeight={240} />;
  }

  const home = getPortalHomePath(roles, portalHomeOptionsFromSession(auth));
  if (home === null) {
    return <NoPortalAccess />;
  }
  if (home !== "/") {
    return <Navigate to={home} replace />;
  }

  return <Dashboard />;
}
