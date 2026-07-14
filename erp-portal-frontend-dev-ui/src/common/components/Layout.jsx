import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { activeModuleId, roleLabel } from "../constants/branding.js";
import { resolveProjectNavSections } from "../../modules/projects/lib/pmNav.js";
import { useAuth } from "../context/AuthContext.jsx";
import {
  getFinanceNavSections,
  hasFinancePortalAccess,
  resolveFinanceRole,
} from "../../modules/finance/financeNav.js";
import {
  getManufacturingNavSections,
  resolveManufacturingRole,
} from "../../modules/manufacturing/manufacturingNav.js";
import { SidebarAccordionNav, SidebarAdminNav, SidebarProjectNav } from "./SidebarAccordionNav.jsx";
import ProgramApprovalNotificationBell from "../../modules/projects/components/ProgramApprovalNotificationBell.jsx";
import PortalNotificationBell from "./PortalNotificationBell.jsx";
import PortalToaster from "./PortalToast.jsx";
import PortalChatbot from "./PortalChatbot.jsx";
import PortalPageTransition from "./PortalPageTransition.jsx";
import AppBrand from "./AppBrand.jsx";
import {
  getSupplyChainNavSections,
  hasScmPortalAccess,
} from "../../modules/supply_chain/supplyChainNav.js";
import { isPortalAdministrator, portalUserRoleLabel } from "../utils/portalAccess.js";
import { hasSalesPortalRole } from "../utils/portalHome.js";
import { buildSalesNavForPortalRoles } from "../../modules/sales/portalSidebar.js";

const STORAGE_KEY = "pm-sidebar-open";

export default function Layout() {
  const {
    user,
    fullName,
    roles,
    isManager,
    isAdministrator,
    isDeveloper,
    isTester,
    isBusinessAnalyst,
    logout,
  } = useAuth();
  const mfgRole = resolveManufacturingRole(roles);
  const financeRole = resolveFinanceRole(roles, user);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const displayName = fullName || user;
  const userInitial = (displayName || "U").trim().charAt(0).toUpperCase();
  const moduleKey = activeModuleId(pathname);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const mainRef = useRef(null);
  const projectNavSections = resolveProjectNavSections({ isManager, isBusinessAnalyst });
  const manufacturingNavSections = mfgRole ? getManufacturingNavSections(mfgRole) : null;
  const showFullErpModules = isPortalAdministrator(roles, { isAdministrator, user });
  const showFinanceModuleNav = hasFinancePortalAccess(roles, user) && !showFullErpModules;
  const financeNavSections = showFinanceModuleNav
    ? getFinanceNavSections(financeRole)
    : null;
  const showSalesModuleNav =
    hasSalesPortalRole(roles) && !showFinanceModuleNav && !showFullErpModules;
  const salesNavSections = useMemo(
    () => (showSalesModuleNav ? buildSalesNavForPortalRoles(roles) : null),
    [showSalesModuleNav, roles]
  );
  const showManufacturingModuleNav =
    !!manufacturingNavSections && !showFinanceModuleNav && !showSalesModuleNav && !showFullErpModules;
  const showScmModuleNav =
    hasScmPortalAccess(roles, { isAdministrator, user }) &&
    !showFinanceModuleNav &&
    !showSalesModuleNav &&
    !showManufacturingModuleNav &&
    !showFullErpModules;
  const scmNavSections = showScmModuleNav ? getSupplyChainNavSections() : null;
  const showAdminNav = isPortalAdministrator(roles, { isAdministrator, user });
  const displayRole = portalUserRoleLabel({
    roles,
    isManager,
    isAdministrator,
    user,
    mfgRole,
    financeRole: showFinanceModuleNav ? financeRole : null,
    isDeveloper,
    isTester,
    isBusinessAnalyst,
    roleLabelFn: roleLabel,
  });
  const closeMobileSidebar = () => {
    if (window.innerWidth < 1024) setSidebarOpen(false);
  };
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(STORAGE_KEY) !== "false";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, sidebarOpen ? "true" : "false");
  }, [sidebarOpen]);

  useEffect(() => {
    if (!userMenuOpen) return undefined;
    function onDocPointerDown(event) {
      if (!userMenuRef.current?.contains(event.target)) setUserMenuOpen(false);
    }
    function onDocKeyDown(event) {
      if (event.key === "Escape") setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocPointerDown);
    document.addEventListener("keydown", onDocKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown);
      document.removeEventListener("keydown", onDocKeyDown);
    };
  }, [userMenuOpen]);

  async function onLogout() {
    setUserMenuOpen(false);
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className={`pm-app${sidebarOpen ? "" : " pm-app--sidebar-closed"}`}>
      <aside className="pm-sidebar" aria-hidden={!sidebarOpen}>
        <div className="pm-sidebar__top">
          <AppBrand variant="sidebar" />
          <button
            type="button"
            className="pm-sidebar__close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
            title="Close menu"
          >
            ×
          </button>
        </div>

        <nav className="pm-sidebar__nav" aria-label="Main navigation">
          {showFullErpModules ? (
            <SidebarAccordionNav
              activeModuleKey={moduleKey}
              onNavigate={closeMobileSidebar}
              showErpModules
              roles={roles}
            />
          ) : financeNavSections ? (
            <SidebarProjectNav
              sections={financeNavSections}
              onNavigate={closeMobileSidebar}
              navHeading="Finance"
              moduleAccent="#34d399"
            />
          ) : salesNavSections ? (
            <SidebarProjectNav
              sections={salesNavSections}
              onNavigate={closeMobileSidebar}
              navHeading="Sales"
              moduleAccent="#8b5cf6"
            />
          ) : showManufacturingModuleNav ? (
            <SidebarProjectNav
              sections={manufacturingNavSections}
              onNavigate={closeMobileSidebar}
              navHeading="Manufacturing Operations"
              moduleAccent="#f97316"
            />
          ) : scmNavSections ? (
            <SidebarProjectNav
              sections={scmNavSections}
              onNavigate={closeMobileSidebar}
              navHeading="Supply Chain"
              moduleAccent="#fb7185"
            />
          ) : (
            <SidebarProjectNav sections={projectNavSections} onNavigate={closeMobileSidebar} />
          )}
          {showAdminNav ? <SidebarAdminNav onNavigate={closeMobileSidebar} /> : null}
        </nav>
      </aside>

      {sidebarOpen ? (
        <button
          type="button"
          className="pm-sidebar-backdrop"
          aria-label="Close navigation overlay"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <div className="pm-main-shell">
        <header className="pm-topbar">
          <button
            type="button"
            className="pm-sidebar-toggle"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label={sidebarOpen ? "Close menu" : "Open menu"}
            aria-expanded={sidebarOpen}
          >
            <span className="pm-sidebar-toggle__icon" aria-hidden="true">
              ☰
            </span>
          </button>
          <div className="pm-topbar__actions">
            <div className="pm-topbar__notify-group">
              <PortalNotificationBell refreshKey={pathname} />
              {isAdministrator ? (
                <ProgramApprovalNotificationBell refreshKey={pathname} />
              ) : null}
            </div>
            <div className="pm-topbar__user-menu" ref={userMenuRef}>
              <button
                type="button"
                className={`pm-topbar__avatar-btn${userMenuOpen ? " pm-topbar__avatar-btn--open" : ""}`}
                onClick={() => setUserMenuOpen((open) => !open)}
                aria-label="Open user menu"
                aria-expanded={userMenuOpen}
              >
                <span className="pm-topbar__user-avatar" aria-hidden="true">
                  {userInitial}
                </span>
              </button>
              {userMenuOpen ? (
                <div className="pm-topbar__user-dropdown" role="menu" aria-label="User menu">
                  <div className="pm-topbar__user-dropdown-head">
                    <span className="pm-topbar__user-avatar pm-topbar__user-avatar--lg" aria-hidden="true">
                      {userInitial}
                    </span>
                    <div>
                      <div className="pm-topbar__user-label">Signed in as</div>
                      <div className="pm-topbar__user-name">{displayName}</div>
                      <div className="pm-topbar__user-role">{displayRole}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="pm-btn pm-btn-ghost pm-topbar__logout"
                    onClick={onLogout}
                    role="menuitem"
                  >
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main className="pm-main" ref={mainRef}>
          <PortalPageTransition scrollRef={mainRef} />
        </main>
      </div>
      <PortalToaster />
      <PortalChatbot />
    </div>
  );
}
