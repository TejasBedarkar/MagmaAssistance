import React from "react";
import { Link } from "react-router-dom";

export default function ModulePlaceholder({ title, description, moduleHome = "/" }) {
  const homeLabel = moduleHome === "/" ? "Projects" : moduleHome.replace(/^\//, "").replace(/-/g, " ");

  return (
    <div className="pm-card" style={{ maxWidth: 560 }}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          marginBottom: 10,
          borderRadius: 999,
          border: "1px solid rgba(148, 163, 184, 0.35)",
          background: "rgba(56, 189, 248, 0.08)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "#7dd3fc",
        }}
      >
        Coming Soon
      </div>
      <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>{title}</h2>
      <p className="pm-page-desc" style={{ marginBottom: 20 }}>
        {description}
      </p>
      <p className="pm-muted" style={{ marginBottom: 16 }}>
        This screen is not available in the portal yet. Your team can add it under{" "}
        <code>erp-portal/src/modules/</code> when the Frappe backend is ready.
      </p>
      <Link className="pm-btn pm-btn-primary" to={moduleHome}>
        Back to {homeLabel}
      </Link>
    </div>
  );
}
