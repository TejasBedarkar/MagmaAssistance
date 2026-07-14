import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { isPortalAdministrator } from "../utils/portalAccess.js";

/** Shown when a user is logged in but has no portal module role assigned. */
export default function NoPortalAccess() {
  const { logout, roles, isAdministrator, user } = useAuth();
  const showAdminLink = isPortalAdministrator(roles, { isAdministrator, user });

  async function onSignOut() {
    await logout();
    window.location.href = "/login";
  }

  return (
    <div className="pm-empty" style={{ padding: 48, maxWidth: 520, margin: "0 auto", textAlign: "center" }}>
      <h2 style={{ margin: "0 0 12px", fontSize: "1.25rem" }}>No portal access</h2>
      <p style={{ margin: "0 0 20px", color: "var(--muted)", lineHeight: 1.6 }}>
        Your account is active, but no module role is assigned yet. Ask your administrator to assign a
        portal role (Project Management, Sales, Finance, or Manufacturing).
      </p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        <button type="button" className="pm-btn pm-btn-primary" onClick={onSignOut}>
          Sign out
        </button>
        {showAdminLink ? (
          <Link to="/users" className="pm-btn pm-btn-secondary">
            User admin
          </Link>
        ) : null}
      </div>
    </div>
  );
}
