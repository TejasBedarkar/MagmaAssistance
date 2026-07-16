import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  HiOutlineLockClosed,
  HiOutlineMagnifyingGlass,
  HiOutlineShieldCheck,
  HiOutlineUserGroup,
  HiOutlineUserPlus,
} from "react-icons/hi2";
import {
  deletePortalUser,
  listPortalUsers,
  resetPortalUserPassword,
  setPortalUserEnabled,
} from "../../api/portalUsers.js";
import ActionIconTip from "../../components/ActionIconTip.jsx";
import { PortalInlineLoader, PortalPageLoader } from "../../components/PortalSpinner.jsx";
import ListFilters from "../../components/ListFilters.jsx";
import ListPagination from "../../components/ListPagination.jsx";
import { StatusPill } from "../../components/StatusPill.jsx";
import {
  ALL_PORTAL_ROLES,
  displayPortalRole,
  portalRoleBadgeGroup,
} from "../../constants/portalUserRoles.js";
import usePagedRows from "../../hooks/usePagedRows.js";
import usePortalToast from "../../hooks/usePortalToast.js";

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
];

const MAX_ROLE_PILLS = 2;

function userInitials(row) {
  const name = (row.full_name || row.first_name || row.email || row.name || "?").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function formatLastActive(value) {
  if (!value) return { primary: "Never", secondary: "No sign-in recorded" };
  try {
    const date = new Date(value);
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return { primary: "Just now", secondary: date.toLocaleString() };
    if (diffMins < 60) return { primary: `${diffMins}m ago`, secondary: date.toLocaleString() };
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return { primary: `${diffHours}h ago`, secondary: date.toLocaleString() };
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return { primary: `${diffDays}d ago`, secondary: date.toLocaleString() };
    return { primary: date.toLocaleDateString(), secondary: date.toLocaleString() };
  } catch {
    return { primary: String(value), secondary: "" };
  }
}

function orderedRoles(roleNames = []) {
  const portal = roleNames.filter(
    (r) => ALL_PORTAL_ROLES.includes(r) || r === "Administrator" || r === "System Manager"
  );
  const other = roleNames.filter(
    (r) => !ALL_PORTAL_ROLES.includes(r) && r !== "Administrator" && r !== "System Manager"
  );
  return [...portal.map(displayPortalRole), ...other];
}

function rolePillClass(role) {
  const group = portalRoleBadgeGroup(role === "Administrator" ? "System Manager" : role);
  return group ? `pm-user-role-pill pm-user-role-pill--${group}` : "pm-user-role-pill";
}

function UserStat({ label, value, tone, icon: Icon }) {
  return (
    <div className={`pm-users-stat pm-users-stat--${tone}`}>
      <span className={`pm-users-stat__icon pm-users-stat__icon--${tone}`} aria-hidden>
        <Icon className="pm-users-stat__icon-svg" />
      </span>
      <div className="pm-users-stat__content">
        <p className="pm-users-stat__label">{label}</p>
        <p className="pm-users-stat__value">{value}</p>
      </div>
    </div>
  );
}

function UserRolesCell({ roleNames = [] }) {
  const roles = orderedRoles(roleNames);
  if (!roles.length) return <span className="pm-muted">No role</span>;

  const visible = roles.slice(0, MAX_ROLE_PILLS);
  const extra = roles.length - visible.length;

  return (
    <div className="pm-user-roles-pills" title={roles.join(", ")}>
      {visible.map((role) => (
        <span key={role} className={rolePillClass(role)}>
          {displayPortalRole(role)}
        </span>
      ))}
      {extra > 0 ? <span className="pm-user-role-pill pm-user-role-pill--more">+{extra}</span> : null}
    </div>
  );
}

const ICONS = {
  edit: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  enable: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <polyline points="16 11 18 13 22 9" />
    </svg>
  ),
  disable: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="17" y1="8" x2="23" y2="14" />
      <line x1="23" y1="8" x2="17" y2="14" />
    </svg>
  ),
  reset: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  delete: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  ),
};

function actionIcon(busyAction, rowName, action, icon) {
  const loading = busyAction?.user === rowName && busyAction?.action === action;
  return loading ? <PortalInlineLoader size="xs" className="pm-user-act__spinner" /> : icon;
}

function UserRowActions({ row, busyAction, onEdit, onToggleEnabled, onResetPassword, onDelete }) {
  const rowBusy = busyAction?.user === row.name;
  const toggleLabel = row.enabled ? "Disable login" : "Enable login";
  const busyClass = (action) =>
    busyAction?.user === row.name && busyAction?.action === action ? " pm-user-act--loading" : "";

  return (
    <div className="pm-user-row-actions" onClick={(e) => e.stopPropagation()}>
      <ActionIconTip label="Edit user">
        <button
          type="button"
          className="pm-user-act pm-user-act--edit"
          disabled={rowBusy}
          onClick={() => onEdit(row.name)}
          aria-label="Edit user"
        >
          {ICONS.edit}
        </button>
      </ActionIconTip>
      <ActionIconTip label={toggleLabel}>
        <button
          type="button"
          className={`pm-user-act pm-user-act--toggle${row.enabled ? " pm-user-act--toggle-off" : " pm-user-act--toggle-on"}${busyClass("toggle")}`}
          disabled={rowBusy}
          onClick={() => onToggleEnabled(row)}
          aria-label={toggleLabel}
          aria-busy={busyAction?.action === "toggle" && rowBusy}
        >
          {actionIcon(busyAction, row.name, "toggle", row.enabled ? ICONS.disable : ICONS.enable)}
        </button>
      </ActionIconTip>
      <ActionIconTip label="Reset password">
        <button
          type="button"
          className={`pm-user-act pm-user-act--reset${busyClass("reset")}`}
          disabled={rowBusy}
          onClick={() => onResetPassword(row)}
          aria-label="Reset password"
          aria-busy={busyAction?.action === "reset" && rowBusy}
        >
          {actionIcon(busyAction, row.name, "reset", ICONS.reset)}
        </button>
      </ActionIconTip>
      <ActionIconTip label="Delete user">
        <button
          type="button"
          className={`pm-user-act pm-user-act--delete${busyClass("delete")}`}
          disabled={rowBusy}
          onClick={() => onDelete(row)}
          aria-label="Delete user"
          aria-busy={busyAction?.action === "delete" && rowBusy}
        >
          {actionIcon(busyAction, row.name, "delete", ICONS.delete)}
        </button>
      </ActionIconTip>
    </div>
  );
}

export default function UsersListPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = usePortalToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [actionBusy, setActionBusy] = useState(null);
  const saveNoticeHandledRef = useRef("");

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPortalUsers();
      setRows(data || []);
    } catch (e) {
      setRows([]);
      showToast(e.message || "Could not load users", "error", 4500);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    const msg = location.state?.userSaveNotice;
    if (!msg || saveNoticeHandledRef.current === msg) return;

    saveNoticeHandledRef.current = msg;
    navigate(location.pathname, { replace: true, state: {} });
    showToast(msg, "success");
    loadUsers();
  }, [location.pathname, location.state?.userSaveNotice, navigate, showToast, loadUsers]);

  const stats = useMemo(() => {
    const enabled = rows.filter((r) => r.enabled).length;
    return { total: rows.length, enabled, disabled: rows.length - enabled };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === "enabled" && !r.enabled) return false;
      if (statusFilter === "disabled" && r.enabled) return false;
      if (!q) return true;
      const hay = `${r.name || ""} ${r.email || ""} ${r.full_name || ""} ${r.first_name || ""} ${(r.roleNames || []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, statusFilter]);

  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(filtered, PAGE_SIZE);

  function openUser(name) {
    navigate(`/users/${encodeURIComponent(name)}`);
  }

  async function onToggleEnabled(row) {
    const nextEnabled = !row.enabled;
    const label = row.full_name || row.email || row.name;
    const ok = window.confirm(
      nextEnabled ? `Enable login for ${label}?` : `Disable login for ${label}? They will not be able to sign in.`
    );
    if (!ok) return;

    setActionBusy({ user: row.name, action: "toggle" });
    try {
      await setPortalUserEnabled(row.name, nextEnabled);
      setRows((prev) => prev.map((r) => (r.name === row.name ? { ...r, enabled: nextEnabled ? 1 : 0 } : r)));
      showToast(nextEnabled ? `${label} enabled.` : `${label} disabled.`);
    } catch (e) {
      showToast(e.message || "Could not update user status", "error");
    } finally {
      setActionBusy(null);
    }
  }

  async function onResetPassword(row) {
    const email = row.email || row.name;
    const label = row.full_name || email;
    const ok = window.confirm(`Send password reset email to ${email}?`);
    if (!ok) return;

    setActionBusy({ user: row.name, action: "reset" });
    try {
      const message = await resetPortalUserPassword(email);
      showToast(message || `Password reset email sent to ${label}.`);
    } catch (e) {
      showToast(e.message || "Could not send password reset", "error");
    } finally {
      setActionBusy(null);
    }
  }

  async function onDelete(row) {
    const label = row.full_name || row.email || row.name;
    const ok = window.confirm(
      `Delete ${label} permanently?\n\nThis removes the user account and cannot be undone.`
    );
    if (!ok) return;

    setActionBusy({ user: row.name, action: "delete" });
    try {
      const result = await deletePortalUser(row.name);
      setRows((prev) => prev.filter((r) => r.name !== row.name));
      showToast(result?.message || `${label} deleted.`);
    } catch (e) {
      showToast(e.message || "Could not delete user", "error");
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <div className="pm-page pm-users-page">
      <div className="pm-users-stats" aria-label="User summary">
        <UserStat label="Total users" value={stats.total} tone="total" icon={HiOutlineUserGroup} />
        <UserStat label="Enabled" value={stats.enabled} tone="enabled" icon={HiOutlineShieldCheck} />
        <UserStat label="Disabled" value={stats.disabled} tone="disabled" icon={HiOutlineLockClosed} />
        <UserStat label="Showing" value={total} tone="filtered" icon={HiOutlineMagnifyingGlass} />
      </div>

      <div className="pm-card pm-users-card">
        <div className="pm-users-card__toolbar">
          <div className="pm-user-list-toolbar">
            <ListFilters
              statusValue={statusFilter}
              statusOptions={STATUS_OPTIONS}
              onStatusChange={(v) => {
                setStatusFilter(v);
                resetPage();
              }}
              searchValue={search}
              onSearchChange={(v) => {
                setSearch(v);
                resetPage();
              }}
              searchPlaceholder="Search name, email, or role…"
            />
            <Link to="/users/new" className="pm-users-new-btn">
              <HiOutlineUserPlus className="pm-users-new-btn__icon" aria-hidden />
              New user
            </Link>
          </div>
        </div>

        <div className="pm-users-card__body">
          {loading ? (
            <PortalPageLoader message="Loading users…" className="pm-users-loading" />
          ) : (
            <>
              <div className="pm-table-wrap">
                <table className="pm-table pm-table--users">
                  <colgroup>
                    <col className="pm-col-user" />
                    <col className="pm-col-roles" />
                    <col className="pm-col-status" />
                    <col className="pm-col-last-active" />
                    <col className="pm-col-actions" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="pm-col-user">User</th>
                      <th className="pm-col-roles">Role</th>
                      <th className="pm-col-status">Status</th>
                      <th className="pm-col-last-active">Last active</th>
                      <th className="pm-col-actions col-action">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.length === 0 ? (
                      <tr>
                        <td colSpan={5}>
                          <div className="pm-users-empty">
                            <p className="pm-users-empty__title">No users match your filters</p>
                            <p>Try a different search or clear the status filter.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      pageRows.map((row) => {
                        const displayName = row.full_name || row.first_name || row.name;
                        const email = row.email || row.name;
                        const userPath = `/users/${encodeURIComponent(row.name)}`;
                        const lastActive = formatLastActive(row.last_active || row.modified);
                        return (
                          <tr
                            key={row.name}
                            className="pm-table-row--clickable"
                            onClick={() => openUser(row.name)}
                          >
                            <td>
                              <div className="pm-user-cell">
                                <span
                                  className={`pm-user-cell__avatar${row.enabled ? "" : " pm-user-cell__avatar--disabled"}`}
                                  aria-hidden
                                >
                                  {userInitials(row)}
                                </span>
                                <div className="pm-user-cell__text">
                                  <Link
                                    to={userPath}
                                    className="pm-user-cell__name"
                                    title={displayName}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {displayName}
                                  </Link>
                                  <span className="pm-user-cell__meta">{email}</span>
                                </div>
                              </div>
                            </td>
                            <td className="pm-col-roles">
                              <UserRolesCell roleNames={row.roleNames} />
                            </td>
                            <td className="pm-col-status">
                              <StatusPill tone={row.enabled ? "success" : "default"}>
                                {row.enabled ? "Enabled" : "Disabled"}
                              </StatusPill>
                            </td>
                            <td className="pm-col-last-active">
                              <div className="pm-user-last-active" title={lastActive.secondary}>
                                <strong>{lastActive.primary}</strong>
                              </div>
                            </td>
                            <td className="pm-col-actions col-action">
                              <UserRowActions
                                row={row}
                                busyAction={actionBusy}
                                onEdit={openUser}
                                onToggleEnabled={onToggleEnabled}
                                onResetPassword={onResetPassword}
                                onDelete={onDelete}
                              />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <ListPagination
                page={page}
                totalPages={totalPages}
                total={total}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
