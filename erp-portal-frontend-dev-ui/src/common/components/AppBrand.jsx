import React from "react";
import { BRAND } from "../constants/branding.js";

function MagnaDataMark({ className = "" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 36 40"
      width="36"
      height="40"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M18 2 32 10 18 18 4 10 18 2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M18 10 32 18 18 26 4 18 18 10Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M18 18 32 26 18 34 4 26 18 18Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SidebarWordmark() {
  const label = (BRAND.company || "Magna Data").trim();
  const splitAt = label.lastIndexOf(" ");
  const lead = splitAt > 0 ? label.slice(0, splitAt) : label;
  const tail = splitAt > 0 ? label.slice(splitAt + 1) : "";

  return (
    <div className="pm-app-brand__wordmark" aria-label={BRAND.logoAlt || label}>
      <span className="pm-app-brand__wordmark-lead">{lead.toUpperCase()}</span>
      {tail ? <span className="pm-app-brand__wordmark-tail">{tail.toUpperCase()}</span> : null}
    </div>
  );
}

/**
 * Company logo + accent rule; "ERP Portal" label on login only.
 * Sidebar uses vector lockup (no white PNG box on dark nav).
 * @param {"sidebar" | "login"} variant
 */
export default function AppBrand({ variant = "sidebar" }) {
  const showProductName = variant !== "sidebar";
  const isSidebar = variant === "sidebar";

  if (isSidebar) {
    return (
      <div className="pm-app-brand pm-app-brand--sidebar">
        <div className="pm-app-brand__sidebar-lockup">
          <MagnaDataMark className="pm-app-brand__mark" />
          <SidebarWordmark />
        </div>
      </div>
    );
  }

  return (
    <div className={`pm-app-brand pm-app-brand--${variant}`}>
      <div className="pm-app-brand__logo-panel">
        <img
          src={BRAND.logoUrl}
          alt={BRAND.logoAlt}
          className="pm-app-brand__logo"
          width={195}
          height={54}
          decoding="async"
        />
      </div>
      <div className="pm-app-brand__product">
        <span className="pm-app-brand__rule" aria-hidden="true" />
        {showProductName ? (
          <p className="pm-app-brand__product-name">{BRAND.product}</p>
        ) : null}
      </div>
    </div>
  );
}
