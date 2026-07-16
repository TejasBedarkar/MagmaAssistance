import React, { useCallback, useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { ADMIN_NAV_ITEMS, ERP_MODULES } from "../constants/moduleNavigation.js";
import { sidebarModuleIdsForPortal } from "../../modules/sales/portalSidebar.js";

const MODULE_ORDER = [
  "projects",
  "sales",
  "finance",
  "manufacturing",
  "supply_chain",
];

const MODULE_META = {
  projects: { short: "PM", accent: "#38bdf8" },
  sales: { short: "SL", accent: "#8b5cf6" },
  finance: { short: "FN", accent: "#34d399" },
  supply_chain: { short: "SC", accent: "#fb7185" },
  manufacturing: { short: "MO", accent: "#f97316" },
};

const ITEM_ICON_PATHS = {
  "/": "M3 7.25 8 3l5 4.25V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7.25Z",
  "/my-day": "M8 2.75v2.5M5.25 5.25h5.5M4.5 8.25h7M6.25 11h3.5M8 13.25v.5",
  "/projects": "M3 4.5h10M3 8h10M3 11.5h7",
  "/milestones": "M3 8h10M7 4.5 3 8l4 3.5",
  "/tasks": "M3 4.5h10M3 8h6M3 11.5h8",
  "/team": "M4.5 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm6 1a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM2.75 12c.35-1.35 1.5-2.25 2.9-2.25h.7c1.4 0 2.55.9 2.9 2.25M8.35 12c.32-1.1 1.25-1.85 2.4-1.85h.5c1.15 0 2.08.75 2.4 1.85",
  "/timesheets": "M4.5 3h7A1.5 1.5 0 0 1 13 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 11.5v-7A1.5 1.5 0 0 1 4.5 3Zm1.25 2.75h4.5M5.75 8h4.5m-4.5 2.25h2.5",
  "/sales": "M3.5 10.5 6 8l2 1.5 4-4M3 12.5h10",
  "/sales/pipeline":
    "M3.5 4.5h3v2.5M9.5 4.5h3v4M3.5 11h3v4.5M9.5 9h3v6.5",
  "/sales/list": "M3.5 4.5h9M3.5 8h9M3.5 11.5h6",
  "/sales/customers":
    "M8 2.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Zm-4 9.5c.35-1.65 1.75-2.75 4-2.75s3.65 1.1 4 2.75",
  "/sales/leads": "M8 2.75a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm-4.25 9c.4-1.9 2.02-3.25 4.25-3.25 2.23 0 3.85 1.35 4.25 3.25",
  "/sales/opportunities": "M3.5 11.5 6.5 8.5l2 1.75L12.5 5.5M3.5 4.5h3v3",
  "/sales/quotations": "M4.25 3h6.5A1.25 1.25 0 0 1 12 4.25v7.5A1.25 1.25 0 0 1 10.75 13h-6.5A1.25 1.25 0 0 1 3 11.75v-7.5A1.25 1.25 0 0 1 4.25 3ZM5.25 6h5.5m-5.5 2.25h5.5m-5.5 2.25h3.25",
  "/sales/orders": "M3.5 5h9m-8.5 3h8m-7.5 3h5.5",
  "/sales/invoices": "M4 3h6.5L13 5.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm6.5 0V5.5H13",
  "/sales/payments": "M8 3.25v9.5M5.5 5.5c.45-.75 1.35-1.25 2.5-1.25 1.5 0 2.5.82 2.5 2 0 1.15-.85 1.8-2.5 2.15-1.65.35-2.5 1-2.5 2.2 0 1.2 1.02 2.15 2.55 2.15 1.2 0 2.1-.5 2.55-1.3",
  "/finance": "M3.25 3.25h3v3h-3v-3Zm0 4.5h3v3h-3v-3Zm4.5-4.5h3v3h-3v-3Zm0 4.5h3v3h-3v-3Zm-4.5 4.5h3v3h-3v-3Zm4.5 0h3v3h-3v-3Z",
  "/finance/sales-orders": "M3.5 5h9m-8.5 3h8m-7.5 3h5.5",
  "/finance/delivery-notes": "M3.5 7.5h9M5 10.5h2m2.5 0H11m-7.5 2h9M4 5h8",
  "/finance/sales-invoices": "M4 3h6.5L13 5.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm6.5 0V5.5H13",
  "/finance/customer-aging": "M8 2.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Zm-4 8.75c.4-1.7 1.85-2.75 4-2.75s3.6 1.05 4 2.75",
  "/finance/purchase-orders": "M4.25 3h6.5A1.25 1.25 0 0 1 12 4.25v7.5A1.25 1.25 0 0 1 10.75 13h-6.5A1.25 1.25 0 0 1 3 11.75v-7.5A1.25 1.25 0 0 1 4.25 3Zm1.25 3.25h5M5.5 8.5h5",
  "/finance/purchase-receipts": "M3.5 6.25 8 3.75l4.5 2.5M8 8.75v4.5M3.5 6.25v5L8 13.75l4.5-2.5v-5",
  "/finance/purchase-invoices": "M4 3h6.5L13 5.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm6.5 0V5.5H13",
  "/finance/supplier-aging": "M8 3.5v9M4.75 7.25 8 10.5l3.25-3.25M3.5 12.5h9",
  "/finance/bank-reconciliation": "M4 4h8v8H4zM6.5 4v8M4 6.5h8",
  "/finance/payment-entries": "M8 3.25v9.5M5.5 5.5c.45-.75 1.35-1.25 2.5-1.25 1.5 0 2.5.82 2.5 2 0 1.15-.85 1.8-2.5 2.15-1.65.35-2.5 1-2.5 2.2 0 1.2 1.02 2.15 2.55 2.15 1.2 0 2.1-.5 2.55-1.3",
  "/finance/journal-entries": "M4.5 3h7A1.5 1.5 0 0 1 13 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 11.5v-7A1.5 1.5 0 0 1 4.5 3Zm1.25 2.25h4.5m-4.5 2.5h4.5m-4.5 2.5h2.75",
  "/finance/chart-of-accounts": "M4 4h8v8H4zM6.5 4v8M4 6.5h8",
  "/finance/general-ledger": "M3.5 4.5h9M3.5 8h9M3.5 11.5h6",
  "/finance/trial-balance": "M4.5 12V8.5M7.5 12V5.5M10.5 12V7M3.5 12.5h9",
  "/finance/profit-and-loss": "M4.5 12V8.5M7.5 12V5.5M10.5 12V7M3.5 12.5h9",
  "/finance/balance-sheet": "M4.5 4.5h7v7h-7v-7Zm1.5 1.5v4h4v-4h-4Zm0 6h7v7h-7v-7Zm1.5 1.5v4h4v-4h-4",
  "/finance/cash-flow": "M4.5 4.5h7v2.5h-7V4.5Zm0 4h7v2.5h-7V8.5Zm0 4h4.5v2.5H4.5V12.5M10 12.5h1.5v2.5H10v-2.5Z",
  "/finance/gst-tds": "M4.25 3h6.5A1.25 1.25 0 0 1 12 4.25v7.5A1.25 1.25 0 0 1 10.75 13h-6.5A1.25 1.25 0 0 1 3 11.75v-7.5A1.25 1.25 0 0 1 4.25 3ZM5.5 6h5M5.5 8.5h5",
  "/finance/budget": "M3.5 11.5h9M5 9V5.5M8 9V4.25M11 9V6.5",
  "/finance/fixed-assets": "M4.5 4.5h7v7h-7zM3.25 11.75l1.5-1.5m6.5 1.5-1.5-1.5",
  "/finance/company-setup": "M4.25 3h6.5A1.25 1.25 0 0 1 12 4.25v7.5A1.25 1.25 0 0 1 10.75 13h-6.5A1.25 1.25 0 0 1 3 11.75v-7.5A1.25 1.25 0 0 1 4.25 3ZM5.5 6h5M5.5 8.5h5M8 3.25v9.5",
  "/supply-chain": "M3.5 5.5 8 3l4.5 2.5v5L8 13l-4.5-2.5v-5Z",
  "/supply-chain/products": "M4.5 4.5h7v7h-7zM3.25 11.75l1.5-1.5m6.5 1.5-1.5-1.5",
  "/supply-chain/bom": "M3.5 4.5h9M3.5 8h6M3.5 11.5h8",
  "/supply-chain/plant": "M3.5 11.75V6l4.5-2.5L12.5 6v5.75M3.5 11.75h9",
  "/supply-chain/inventory": "M3.5 6.25 8 3.75l4.5 2.5M8 8.75v4.5M3.5 6.25v5L8 13.75l4.5-2.5v-5",
  "/supply-chain/stock-transfer": "M3.5 7.5h9M5 10.5h2m2.5 0H11m-7.5 2h9M4 5h8",
  "/supply-chain/warehouses": "M3.5 11.75V6l4.5-2.5L12.5 6v5.75M3.5 11.75h9",
  "/supply-chain/suppliers": "M8 2.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Zm-4 8.75c.4-1.7 1.85-2.75 4-2.75s3.6 1.05 4 2.75",
  "/supply-chain/material-requests": "M4.25 3h6.5A1.25 1.25 0 0 1 12 4.25v7.5A1.25 1.25 0 0 1 10.75 13h-6.5A1.25 1.25 0 0 1 3 11.75v-7.5A1.25 1.25 0 0 1 4.25 3Zm1.25 3.25h5M5.5 8.5h5",
  "/supply-chain/rfq": "M4.25 3h6.5A1.25 1.25 0 0 1 12 4.25v7.5A1.25 1.25 0 0 1 10.75 13h-6.5A1.25 1.25 0 0 1 3 11.75v-7.5A1.25 1.25 0 0 1 4.25 3ZM5.5 6h5M5.5 8.5h5",
  "/supply-chain/purchase-orders": "M4.25 3h6.5A1.25 1.25 0 0 1 12 4.25v7.5A1.25 1.25 0 0 1 10.75 13h-6.5A1.25 1.25 0 0 1 3 11.75v-7.5A1.25 1.25 0 0 1 4.25 3Zm1.25 3.25h5M5.5 8.5h5",
  "/supply-chain/grn": "M3.5 6.25 8 3.75l4.5 2.5M8 8.75v4.5M3.5 6.25v5L8 13.75l4.5-2.5v-5",
  "/supply-chain/mrp": "M4.5 12V8.5M7.5 12V5.5M10.5 12V7M3.5 12.5h9",
  "/supply-chain/reservations": "M8 3.25v9.5M5.5 5.5c.45-.75 1.35-1.25 2.5-1.25 1.5 0 2.5.82 2.5 2 0 1.15-.85 1.8-2.5 2.15-1.65.35-2.5 1-2.5 2.2 0 1.2 1.02 2.15 2.55 2.15 1.2 0 2.1-.5 2.55-1.3",
  "/supply-chain/rma": "M3.5 7.5h9M5 10.5h2m2.5 0H11m-7.5 2h9M4 5h8",
  "/manufacturing": "M3.5 5.5h9M3.5 9h9M3.5 12.5h9",
  "/manufacturing/work-orders": "M4.25 3h6.5A1.25 1.25 0 0 1 12 4.25v7.5A1.25 1.25 0 0 1 10.75 13h-6.5A1.25 1.25 0 0 1 3 11.75v-7.5A1.25 1.25 0 0 1 4.25 3Zm1.25 3.25h5M5.5 8.5h5",
  "/manufacturing/capacity":
    "M4.5 3h7A1.5 1.5 0 0 1 13 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 11.5v-7A1.5 1.5 0 0 1 4.5 3ZM5.5 2v2m5-2v2M5.5 7h5m-5 2.5h3",
  "/manufacturing/new-product-requirement":
    "M4.25 3h6.5A1.25 1.25 0 0 1 12 4.25v7.5A1.25 1.25 0 0 1 10.75 13h-6.5A1.25 1.25 0 0 1 3 11.75v-7.5A1.25 1.25 0 0 1 4.25 3Zm4 1.5v3m0 0v3m-1.5-1.5h3",
  "/manufacturing/materials": "M3.5 6.25 8 3.75l4.5 2.5M8 8.75v4.5M3.5 6.25v5L8 13.75l4.5-2.5v-5",
  "/manufacturing/production": "M4.5 4.5h7v7h-7zM3.25 11.75l1.5-1.5m6.5 1.5-1.5-1.5",
  "/manufacturing/quality": "M3.75 8 6.75 11 12.25 5.5",
  "/manufacturing/maintenance":
    "M4.5 4.5h7v7h-7zM3.25 11.75l1.5-1.5m6.5 1.5-1.5-1.5M8 8v2.5",
  "/manufacturing/dispatch": "M3.5 7.5h9M5 10.5h2m2.5 0H11m-7.5 2h9M4 5h8",
  "/manufacturing/closure": "M4 4.75h8M4 8h8M4 11.25h5",
  "/manufacturing/reports": "M4.5 12V8.5M7.5 12V5.5M10.5 12V7M3.5 12.5h9",
  "/manufacturing/qc-templates": "M3.75 8 6.75 11 12.25 5.5",
  "/manufacturing/workstations": "M4.5 4.5h7v7h-7zM3.25 11.75l1.5-1.5m6.5 1.5-1.5-1.5",
  "/users":
    "M10.5 5.75a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0ZM3.25 12.25c.45-1.85 2.05-3 4.75-3s4.3 1.15 4.75 3M12.25 11.25a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm3 5c.35-1.45 1.55-2.25 3-2.25s2.65.8 3 2.25",
  "/settings":
    "M8 3.25v1.75M8 11v1.75M4.35 4.35l1.25 1.25M10.4 10.4l1.25 1.25M3.25 8h1.75M11 8h1.75M4.35 11.65l1.25-1.25M10.4 5.6l1.25-1.25M8 9.25a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z",
};

function MenuItemIcon({ to, icon }) {
  const d = icon || ITEM_ICON_PATHS[to] || "M3.5 8h9";
  return (
    <span className="pm-sidebar__link-icon" aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path
          d={d}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** Module-head badge with SVG inside (Users, Settings — same box as PM/SL). */
function ModuleFieldIcon({ to, icon, accent }) {
  const d = icon || ITEM_ICON_PATHS[to] || "M3.5 8h9";
  return (
    <span
      className="pm-sidebar__module-icon pm-sidebar__module-icon--field"
      style={{ "--module-accent": accent }}
      aria-hidden="true"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path
          d={d}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function ChevronIcon({ expanded }) {
  return (
    <svg
      className={`pm-sidebar__chevron${expanded ? " pm-sidebar__chevron--open" : ""}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ModuleNavSections({ sections, onNavigate }) {
  return sections.map((section, sectionIndex) => (
    <div
      key={section.id}
      className={`pm-sidebar__section${sectionIndex > 0 ? " pm-sidebar__section--nested" : ""}`}
    >
      <div className="pm-sidebar__section-label">{section.label}</div>
      <div className="pm-sidebar__section-links">
        {section.items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `pm-sidebar__link pm-sidebar__link--nested${isActive ? " pm-sidebar__link--active" : ""}`
            }
            onClick={onNavigate}
          >
            <MenuItemIcon to={item.to} icon={item.icon} />
            <span className="pm-sidebar__link-text">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </div>
  ));
}

function ModuleGroup({ module, expanded, isCurrentModule, onToggle, onNavigate }) {
  const meta = MODULE_META[module.id] || { short: "?", accent: "var(--accent)" };

  return (
    <div
      className={`pm-sidebar__module${expanded ? " pm-sidebar__module--open" : ""}${
        isCurrentModule ? " pm-sidebar__module--current" : ""
      }`}
      style={{ "--module-accent": meta.accent }}
    >
      <button
        type="button"
        className={`pm-sidebar__module-head${expanded ? " pm-sidebar__module-head--open" : ""}`}
        onClick={() => onToggle(module.id)}
        aria-expanded={expanded}
        aria-controls={`sidebar-module-${module.id}`}
      >
        <span className="pm-sidebar__module-head-main">
          <span className="pm-sidebar__module-icon" aria-hidden="true">
            {meta.short}
          </span>
          <span className="pm-sidebar__module-head-label">{module.label}</span>
        </span>
        <ChevronIcon expanded={expanded} />
      </button>
      {expanded ? (
        <div className="pm-sidebar__module-panel" id={`sidebar-module-${module.id}`}>
          <div className="pm-sidebar__module-body">
            <ModuleNavSections sections={module.nav} onNavigate={onNavigate} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SidebarAccordionNav({
  activeModuleKey,
  onNavigate,
  showErpModules = true,
  roles = [],
}) {
  const navigate = useNavigate();
  const moduleIds =
    sidebarModuleIdsForPortal(showErpModules, roles) ??
    (showErpModules ? MODULE_ORDER : ["projects"]);
  /** Expanded module panel — defaults to the active module (matches PM flat nav UX). */
  const [openModuleId, setOpenModuleId] = useState(() =>
    activeModuleKey && ERP_MODULES[activeModuleKey] ? activeModuleKey : null
  );

  useEffect(() => {
    if (activeModuleKey && ERP_MODULES[activeModuleKey]) {
      setOpenModuleId(activeModuleKey);
    }
  }, [activeModuleKey]);

  const onToggleModule = useCallback(
    (moduleId) => {
      setOpenModuleId((prev) => {
        if (prev === moduleId) {
          return null;
        }
        const mod = ERP_MODULES[moduleId];
        if (mod?.home) {
          navigate(mod.home);
          onNavigate?.();
        }
        return moduleId;
      });
    },
    [navigate, onNavigate]
  );

  const onNavItemClick = useCallback(
    (moduleId) => {
      setOpenModuleId(moduleId);
      onNavigate?.();
    },
    [onNavigate]
  );

  return (
    <>
      <p className="pm-sidebar__nav-heading">Modules</p>
      <div className="pm-sidebar__modules">
        {moduleIds.map((id) => (
          <ModuleGroup
            key={id}
            module={ERP_MODULES[id]}
            expanded={openModuleId === id}
            isCurrentModule={activeModuleKey === id}
            onToggle={onToggleModule}
            onNavigate={() => onNavItemClick(id)}
          />
        ))}
      </div>
    </>
  );
}

/** Administration — module-style badge + label rows. */
export function SidebarAdminNav({ onNavigate }) {
  return (
    <div className="pm-sidebar__admin">
      <p className="pm-sidebar__nav-heading">Administration</p>
      <div className="pm-sidebar__admin-fields">
        {ADMIN_NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            style={{ "--module-accent": item.accent }}
            className={({ isActive }) =>
              `pm-sidebar__link pm-sidebar__link--admin-field${isActive ? " pm-sidebar__link--active" : ""}`
            }
            onClick={onNavigate}
          >
            <ModuleFieldIcon to={item.to} icon={item.icon} accent={item.accent} />
            <span className="pm-sidebar__module-head-label">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
}

export function SidebarProjectNav({
  sections,
  onNavigate,
  navHeading = "Navigation",
  moduleAccent,
}) {
  const accent = moduleAccent || MODULE_META.projects.accent;
  return (
    <>
      <p className="pm-sidebar__nav-heading">{navHeading}</p>
      <div
        className="pm-sidebar__module pm-sidebar__module--open pm-sidebar__module--static"
        style={{ "--module-accent": accent }}
      >
        <div className="pm-sidebar__module-body pm-sidebar__module-body--flat">
          <ModuleNavSections sections={sections} onNavigate={onNavigate} />
        </div>
      </div>
    </>
  );
}
