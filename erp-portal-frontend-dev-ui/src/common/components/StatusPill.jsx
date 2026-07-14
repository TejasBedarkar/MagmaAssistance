import React from "react";

export function StatusPill({ children, tone = "default" }) {
  const cls =
    tone === "success"
      ? "pm-pill pm-pill-success"
      : tone === "warn"
        ? "pm-pill pm-pill-warn"
        : tone === "danger"
          ? "pm-pill pm-pill-danger"
          : tone === "info"
            ? "pm-pill pm-pill-info"
            : "pm-pill";
  return <span className={cls}>{children}</span>;
}
