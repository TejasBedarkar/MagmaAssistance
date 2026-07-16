import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { HiOutlineCheckBadge } from "react-icons/hi2";
import { callMethod, callMethodGet } from "../api/client.js";
import { activeModuleId, ERP_MODULES } from "../constants/moduleNavigation.js";
import { useAuth } from "../context/AuthContext.jsx";
import BellIcon from "./icons/BellIcon.jsx";
import { isPortalAdministrator } from "../utils/portalAccess.js";
import { hasSalesPortalRole } from "../utils/portalHome.js";
import { resolveManufacturingRole } from "../../modules/manufacturing/manufacturingNav.js";
import { PORTAL_NOTIFICATIONS_REFRESH } from "../utils/portalNotifications.js";
import {
  hasPmPortalRole,
  isDeliveryMemberRole,
} from "../../modules/projects/lib/roles.js";
import { hasFinancePortalAccess } from "../../modules/finance/financeNav.js";

const PANEL = {
  title: "Notifications",
  empty: "No new notifications.",
  aria: "ERP portal notifications",
  titleBtn: "Notifications",
};

const POLL_MS = 30000;
const MFG_METHOD_LIST = "manufacturing_operations.api.notifications.get_my_notifications";
const MFG_METHOD_MARK_READ = "manufacturing_operations.api.notifications.mark_read";
const SALES_METHOD_LIST = "sales_app.api.notifications_proxy.get_portal_notifications";
const SALES_METHOD_MARK_READ = "sales_app.api.notifications_proxy.mark_portal_notification_read";
const FINANCE_METHOD_LIST = "finance_app.api.notifications_proxy.get_portal_notifications";
const FINANCE_METHOD_MARK_READ = "finance_app.api.notifications_proxy.mark_portal_notification_read";
const FINANCE_METHOD_MARK_ALL_READ =
  "finance_app.api.notifications_proxy.mark_all_portal_notifications_read";

const PM_PORTAL_ROLES = new Set([
  "Project Manager",
  "Developer",
  "Tester",
  "Business Analyst",
  "System Manager",
]);

/** Module badge colors — aligned with sidebar module accents. */
const MODULE_BADGE_STYLE = {
  projects: { bg: "rgba(56, 189, 248, 0.15)", color: "#38bdf8" },
  sales: { bg: "rgba(139, 92, 246, 0.15)", color: "#8b5cf6" },
  finance: { bg: "rgba(52, 211, 153, 0.15)", color: "#34d399" },
  operations: { bg: "rgba(251, 191, 36, 0.15)", color: "#fbbf24" },
  supply_chain: { bg: "rgba(251, 113, 133, 0.15)", color: "#fb7185" },
  manufacturing: { bg: "rgba(249, 115, 22, 0.15)", color: "#f97316" },
};

function formatWhen(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function moduleBadgeStyle(module) {
  return MODULE_BADGE_STYLE[module] || MODULE_BADGE_STYLE.projects;
}

const PM_NOTIFICATION_LOG_TYPES = new Set([
  "PM Project",
  "PM Task",
  "PM Timesheet",
  "PM Milestone",
]);

const MFG_NOTIFICATION_LOG_TYPES = new Set([
  "MFG Work Order",
  "MFG Job Card",
  "MFG Quality Inspection",
]);

function isPmNotificationLog(row) {
  const docType = row?.document_type || "";
  return PM_NOTIFICATION_LOG_TYPES.has(docType) || docType.startsWith("PM ");
}

function isMfgNotificationLog(row) {
  const docType = row?.document_type || "";
  return MFG_NOTIFICATION_LOG_TYPES.has(docType) || docType.startsWith("MFG ");
}

function pmHrefForLog(row) {
  const docType = row.document_type || "";
  const docName = row.document_name || "";
  if (docType === "PM Task" && docName) return `/tasks/${docName}`;
  if (docType === "PM Project" && docName) return `/projects/${docName}`;
  if (docType === "PM Timesheet" && docName) return `/timesheets/${docName}`;
  if (docType === "PM Milestone" && docName) return `/milestones/${docName}`;
  return ERP_MODULES.projects.home;
}

function mfgHrefForLog(row) {
  if (row.document_type === "MFG Work Order" && row.document_name) {
    return `/manufacturing/work-orders/${row.document_name}`;
  }
  if (row.document_type === "MFG Job Card" && row.document_name) {
    return "/manufacturing/production";
  }
  if (row.document_type === "MFG Quality Inspection" && row.document_name) {
    return "/manufacturing/quality";
  }
  if (row.document_type === "MFG Maintenance Ticket" && row.document_name) {
    return "/manufacturing/maintenance";
  }
  return "/manufacturing";
}

/** Notification Log rows are shared; label by document_type (not all as Mfg). */
function mapNotificationLogRow(row) {
  if (isPmNotificationLog(row)) {
    return {
      id: `pm-log-${row.name}`,
      source: "pm_log",
      mfg_name: row.name,
      kind: "pm_notification_log",
      module: "projects",
      module_label: "Project Management",
      title: row.subject || "Project alert",
      subtitle: row.email_content || "",
      modified: row.creation,
      href: pmHrefForLog(row),
      read: row.read ? 1 : 0,
    };
  }
  if (isMfgNotificationLog(row)) {
    return {
      id: `mfg-${row.name}`,
      source: "mfg",
      mfg_name: row.name,
      kind: "mfg_alert",
      module: "manufacturing",
      module_label: "Manufacturing Operations",
      title: row.subject || "Manufacturing alert",
      subtitle: row.email_content || "",
      modified: row.creation,
      href: mfgHrefForLog(row),
      read: row.read ? 1 : 0,
    };
  }
  return null;
}

function shouldLoadProjectNotifications({ roles, isAdministrator, isManager, user }) {
  if (isPortalAdministrator(roles, { isAdministrator, user })) return true;
  if (isManager) return true;
  return roles.some((role) => PM_PORTAL_ROLES.has(role));
}

function shouldLoadManufacturingNotifications({ roles, isAdministrator, user }) {
  if (isPortalAdministrator(roles, { isAdministrator, user })) return true;
  return Boolean(resolveManufacturingRole(roles));
}

function shouldLoadSalesNotifications({ roles, isAdministrator, user }) {
  if (isPortalAdministrator(roles, { isAdministrator, user })) return true;
  return hasSalesPortalRole(roles);
}

function shouldLoadFinanceNotifications({ roles, isAdministrator, user }) {
  if (isPortalAdministrator(roles, { isAdministrator, user })) return true;
  return hasFinancePortalAccess(roles, user);
}

function resolveItemPath(item) {
  if (item.href) return item.href;
  if (item.project && item.kind?.startsWith("program_")) {
    return `/projects/${item.project}`;
  }
  if (item.task) return `/tasks/${item.task}`;
  if (item.name && item.kind?.startsWith("timesheet")) {
    return `/timesheets/${item.name}`;
  }
  if (item.module === "manufacturing") {
    return ERP_MODULES.manufacturing.home;
  }
  if (item.module === "sales") {
    return item.href || ERP_MODULES.sales.home;
  }
  if (item.module === "finance") {
    return item.href || ERP_MODULES.finance.home;
  }
  return ERP_MODULES.projects.home;
}

function shortModuleLabel(label) {
  if (!label) return "";
  if (label === "Manufacturing Operations") return "Mfg";
  if (label === "Project Management") return "Projects";
  if (label === "Sales") return "Sales";
  if (label === "Finance") return "Finance";
  return label.length > 12 ? `${label.slice(0, 10)}…` : label;
}

function mergeAndSort(pmItems, mfgItems, salesItems = [], financeItems = []) {
  return [...pmItems, ...mfgItems, ...salesItems, ...financeItems].sort(
    (a, b) => new Date(b.modified || 0).getTime() - new Date(a.modified || 0).getTime()
  );
}

export default function PortalNotificationBell({ refreshKey }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, roles, isAdministrator, isManager, isProgramManager } = useAuth();
  const wrapRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [markAllBusy, setMarkAllBusy] = useState(false);

  const authCtx = useMemo(
    () => ({ roles, isAdministrator, isManager, user }),
    [roles, isAdministrator, isManager, user]
  );

  const loadPm = useMemo(
    () => shouldLoadProjectNotifications(authCtx),
    [authCtx]
  );

  const loadMfg = useMemo(
    () => shouldLoadManufacturingNotifications(authCtx),
    [authCtx]
  );

  const loadSales = useMemo(
    () => shouldLoadSalesNotifications(authCtx),
    [authCtx]
  );

  const loadFinance = useMemo(
    () => shouldLoadFinanceNotifications(authCtx),
    [authCtx]
  );

  const activeModule = useMemo(() => {
    const id = activeModuleId(pathname);
    return ERP_MODULES[id] || ERP_MODULES.projects;
  }, [pathname]);

  const footerLabel = `Open ${activeModule.label}`;
  const footerPath = activeModule.home;

  const mfgCount = useMemo(
    () => items.filter((row) => row.module === "manufacturing").length,
    [items]
  );

  const financeCount = useMemo(
    () => items.filter((row) => row.source === "finance").length,
    [items]
  );

  const badgeCount = items.length;

  const load = useCallback(async () => {
    setLoading(true);
    let pmItems = [];
    let mfgItems = [];
    let salesItems = [];
    let financeItems = [];

    if (loadPm) {
      try {
        const data = await callMethodGet("project_management.api.get_portal_notifications");
        const rows = data.items || [];
        pmItems = isPortalAdministrator(roles, { isAdministrator, user })
          ? rows
          : rows.filter((row) => row.kind !== "program_pending_approval");
      } catch {
        pmItems = [];
      }
    }

    if (loadMfg) {
      try {
        const data = await callMethod(MFG_METHOD_LIST, { limit: 20 });
        const logItems = (data.items || [])
          .filter((row) => !row.read)
          .map(mapNotificationLogRow)
          .filter(Boolean);
        for (const item of logItems) {
          if (item.module === "projects") {
            pmItems.push(item);
          } else {
            mfgItems.push(item);
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (loadSales) {
      try {
        const data = await callMethodGet(SALES_METHOD_LIST, { limit: 20 });
        salesItems = (data.items || []).map((row) => ({
          ...row,
          source: "sales",
          module: row.module || "sales",
          module_label: row.module_label || "Sales",
        }));
      } catch {
        salesItems = [];
      }
    }

    if (loadFinance) {
      try {
        const data = await callMethodGet(FINANCE_METHOD_LIST, { limit: 20 });
        financeItems = (data.items || []).map((row) => ({
          ...row,
          source: "finance",
          module: row.module || "finance",
          module_label: row.module_label || "Finance",
        }));
      } catch {
        financeItems = [];
      }
    }

    setItems(mergeAndSort(pmItems, mfgItems, salesItems, financeItems));
    setLoading(false);
  }, [loadPm, loadMfg, loadSales, loadFinance, roles, isAdministrator, user]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    function onRefresh() {
      load();
    }
    window.addEventListener(PORTAL_NOTIFICATIONS_REFRESH, onRefresh);
    return () => window.removeEventListener(PORTAL_NOTIFICATIONS_REFRESH, onRefresh);
  }, [load]);

  const panelWasOpenRef = useRef(false);

  useEffect(() => {
    if (open) {
      panelWasOpenRef.current = true;
      load();
      return undefined;
    }
    if (!panelWasOpenRef.current || !loadPm) return undefined;
    let cancelled = false;
    (async () => {
      try {
        await callMethod("project_management.api.mark_portal_notifications_seen");
      } catch {
        /* ignore */
      }
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [open, load, loadPm]);

  const closePanel = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        closePanel();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, closePanel]);

  async function onMarkAllMfg(e) {
    e?.stopPropagation?.();
    if (!mfgCount) return;
    const mfgOnly = items.filter((row) => row.module === "manufacturing" && row.mfg_name);
    if (!mfgOnly.length) return;
    setMarkAllBusy(true);
    try {
      await Promise.all(
        mfgOnly.map((item) => callMethod(MFG_METHOD_MARK_READ, { name: item.mfg_name }))
      );
      await load();
    } catch {
      /* ignore */
    } finally {
      setMarkAllBusy(false);
    }
  }

  async function onMarkAllFinance(e) {
    e?.stopPropagation?.();
    if (!financeCount) return;
    setMarkAllBusy(true);
    try {
      await callMethod(FINANCE_METHOD_MARK_ALL_READ, { limit: 50 });
      await load();
    } catch {
      /* ignore */
    } finally {
      setMarkAllBusy(false);
    }
  }

  async function onItemClick(item) {
    const notificationId = item?.id;
    const isProgramOutcome =
      item?.kind === "program_approved" || item?.kind === "program_rejected";

    if ((item.source === "mfg" || item.source === "pm_log") && item.mfg_name) {
      try {
        await callMethod(MFG_METHOD_MARK_READ, { name: item.mfg_name });
      } catch {
        /* ignore */
      }
      setItems((prev) => prev.filter((row) => row.id !== notificationId));
    } else if (item.source === "sales" && notificationId) {
      try {
        await callMethod(SALES_METHOD_MARK_READ, { notification_id: notificationId });
      } catch {
        /* ignore */
      }
      setItems((prev) => prev.filter((row) => row.id !== notificationId));
    } else if (item.source === "finance" && notificationId) {
      try {
        await callMethod(FINANCE_METHOD_MARK_READ, { notification_id: notificationId });
      } catch {
        /* ignore */
      }
      setItems((prev) => prev.filter((row) => row.id !== notificationId));
    } else if (notificationId) {
      try {
        await callMethod("project_management.api.mark_portal_notification_read", {
          notification_id: notificationId,
        });
      } catch {
        /* ignore */
      }
      setItems((prev) => prev.filter((row) => row.id !== notificationId));
    }

    if (isProgramOutcome && isProgramManager && !isAdministrator) {
      try {
        await callMethod("project_management.api.mark_program_approval_notifications_seen");
      } catch {
        /* ignore */
      }
    }

    closePanel();
    navigate(resolveItemPath(item));
  }

  return (
    <div className="pm-notify-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`pm-notify-btn${open ? " pm-notify-btn--active" : ""}`}
        onClick={() => (open ? closePanel() : setOpen(true))}
        aria-label={badgeCount ? `${badgeCount} notifications` : PANEL.aria}
        aria-expanded={open}
        title={PANEL.titleBtn}
      >
        <span className="pm-notify-btn__icon">
          <BellIcon size={18} />
        </span>
        {badgeCount > 0 ? (
          <span className="pm-notify-badge">{badgeCount > 99 ? "99+" : badgeCount}</span>
        ) : null}
      </button>

      {open ? (
        <div className="pm-notify-panel" role="dialog" aria-label={PANEL.aria}>
          <div className="pm-notify-panel__head">
            <div>
              <h3 className="pm-notify-panel__title">{PANEL.title}</h3>
              {mfgCount > 0 ? (
                <button
                  type="button"
                  className="pm-btn pm-btn-ghost pm-btn-sm"
                  disabled={markAllBusy}
                  onClick={onMarkAllMfg}
                  style={{ marginTop: 6, fontSize: 12 }}
                >
                  <HiOutlineCheckBadge size={14} aria-hidden /> Mark all read (Mfg)
                </button>
              ) : null}
              {financeCount > 0 ? (
                <button
                  type="button"
                  className="pm-btn pm-btn-ghost pm-btn-sm"
                  disabled={markAllBusy}
                  onClick={onMarkAllFinance}
                  style={{ marginTop: 6, fontSize: 12 }}
                >
                  <HiOutlineCheckBadge size={14} aria-hidden /> Mark all read (Finance)
                </button>
              ) : null}
            </div>
            <span className="pm-notify-panel__meta">
              {loading ? "Loading…" : badgeCount ? `${badgeCount} new` : "All caught up"}
            </span>
          </div>
          <div className="pm-notify-panel__body">
            {!loading && items.length === 0 ? <p className="pm-notify-empty">{PANEL.empty}</p> : null}
            {items.map((item) => {
              const badge = moduleBadgeStyle(item.module);
              const isMfg = item.module === "manufacturing";
              const badgeLabel = shortModuleLabel(item.module_label);
              return (
                <button
                  key={item.id || item.mfg_name || item.name}
                  type="button"
                  className={`pm-notify-item${isMfg ? " pm-notify-item--unread" : ""}`}
                  onClick={() => onItemClick(item)}
                >
                  {badgeLabel ? (
                    <span
                      className="pm-notify-item__module"
                      style={{ background: badge.bg, color: badge.color }}
                    >
                      {badgeLabel}
                    </span>
                  ) : null}
                  <span className="pm-notify-item__title">{item.title || item.task_title}</span>
                  <span className="pm-notify-item__sub">{item.subtitle || item.project_name}</span>
                  <span className="pm-notify-item__time">{formatWhen(item.modified)}</span>
                </button>
              );
            })}
          </div>
          <div className="pm-notify-panel__foot">
            <button
              type="button"
              className="pm-notify-foot-link"
              onClick={() => {
                closePanel();
                navigate(footerPath);
              }}
            >
              {footerLabel} →
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
