import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../../common/context/AuthContext.jsx";
import FinancePageLoader from "./FinancePageLoader.jsx";
import { isFinancePathAllowed, resolveFinanceRole } from "../financeNav.js";

/**
 * Blocks /finance URLs that are not allowed for the user's finance role.
 */
export default function FinanceAccessGuard({ children }) {
  const { user, roles, loading } = useAuth();
  const { pathname } = useLocation();
  const financeRole = resolveFinanceRole(roles, user);

  if (loading) {
    return (
      <div className="pm-page finance-page">
        <FinancePageLoader message="Checking finance access…" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!financeRole) {
    return <Navigate to="/" replace />;
  }

  if (!isFinancePathAllowed(pathname, financeRole)) {
    return <Navigate to="/finance" replace />;
  }

  return children;
}
