import React from "react";
import { Link } from "react-router-dom";
import AdminInfoCard from "../components/admin/AdminInfoCard.jsx";

export default function SettingsPage() {
  return (
    <div className="pm-page">
      <header className="pm-page-header">
        <div>
          <p className="pm-page-eyebrow">Administration</p>
          <h1 className="pm-page-title">Settings</h1>
          <p className="pm-page-desc">
            Portal branding, module defaults, and company configuration for administrators.
          </p>
        </div>
      </header>

      <div className="pm-admin-grid">
        <AdminInfoCard
          title="Portal settings"
          description="Branding, default landing module, and portal-wide preferences will be configured here."
          items={[
            "Company logo and portal title",
            "Default module after login",
            "Notification defaults",
          ]}
        />
        <AdminInfoCard
          title="ERP & company setup"
          description="Core company and ERP configuration remains in Frappe Desk under Settings."
          items={["Desk → Settings → Company", "Desk → Settings → System Settings"]}
        />
      </div>

      <p className="pm-muted" style={{ marginTop: 16 }}>
        <Link to="/users" className="pm-link">
          User management
        </Link>
      </p>
    </div>
  );
}
