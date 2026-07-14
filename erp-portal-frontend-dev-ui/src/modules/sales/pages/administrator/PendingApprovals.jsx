import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { HiOutlineCheck, HiOutlineClipboardDocumentCheck, HiOutlineXMark } from "react-icons/hi2";
import api, { prefetchCsrf, toFriendlyError } from "../../lib/apiUtils";
import ListPagination from "../../../../common/components/ListPagination.jsx";
import usePagedRows from "../../../../common/hooks/usePagedRows.js";
import { SALES_PAGE_SIZE_OPTIONS } from "../../lib/pagination.js";
import SalesPageLoader from "../../components/SalesPageLoader.jsx";
import SalesEmptyState from "../../components/SalesEmptyState.jsx";
import SalesDetailModal from "../../components/SalesDetailModal.jsx";
import SalesKpiCard from "../../components/SalesKpiCard.jsx";
import SalesDocumentId from "../../components/SalesDocumentId.jsx";
import useSalesToast, { SalesToast } from "../../components/useSalesToast.jsx";
import { SALES_COLORS as C } from "../../theme/tokens.js";
import { useSalesAuth } from "../../hooks/useSalesAuth.js";
import { allowedActionsByRole } from "../../lib/roles.js";
import { refreshSalesNotifications } from "../../lib/salesNotifications.js";

const fmt = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN")}`;
const fmtK = (n) => {
  const v = Number(n || 0);
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `₹${(v / 1e3).toFixed(0)}k`;
  return fmt(v);
};

const STATUS_PILL = {
  "pending approval": { fg: C.amber, bg: C.amberLt },
  rejected: { fg: C.red, bg: C.redDim },
  open: { fg: C.teal, bg: C.tealLt },
  draft: { fg: C.muted, bg: C.surface2 },
};

function normStatus(value) {
  return String(value ?? "").trim();
}

function rowStatus(row) {
  if (Number(row?.docstatus) === 1) return normStatus(row?.display_status || row?.status) || "Open";
  if (normStatus(row?.portal_approval_status).toLowerCase() === "rejected") return "Rejected";
  if (
    normStatus(row?.portal_approval_status).toLowerCase() === "pending approval"
    || row?.submitted_for_approval_at
    || normStatus(row?.display_status).toLowerCase() === "pending approval"
  ) {
    return "Pending Approval";
  }
  return normStatus(row?.display_status || row?.portal_approval_status) || "Pending Approval";
}

function Pill({ status }) {
  const key = normStatus(status).toLowerCase() || "draft";
  const theme = STATUS_PILL[key] || { fg: C.sub, bg: C.surface2 };
  return (
    <span className="sales-status-pill" style={{ "--pill-fg": theme.fg, "--pill-bg": theme.bg }}>
      {normStatus(status) || "—"}
    </span>
  );
}

function post(url, data) {
  return api.post(url, data, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    transformRequest: [(payload) => new URLSearchParams(payload).toString()],
  });
}

export default function PendingApprovals() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({ pending: 0, approved_open: 0, rejected: 0, pending_value: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [actionName, setActionName] = useState("");
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [setupHint, setSetupHint] = useState("");
  const { toast, showToast } = useSalesToast(3200);
  const { salesRole } = useSalesAuth();
  const approvalPerms = useMemo(() => allowedActionsByRole(salesRole), [salesRole]);
  const canApproveReject = approvalPerms.canApprove && approvalPerms.canReject;

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setSetupHint("");
    try {
      const res = await api.get("/api/method/sales_app.api.quotation.get_quotation_approval_dashboard");
      const payload = res?.data?.message || {};
      if (payload?.status === "error") {
        if (payload?.setup_required) {
          setSetupHint(payload.message || "Approval setup is required on this site.");
        }
        throw new Error(payload.message || "Unable to load pending approvals.");
      }
      setRows(Array.isArray(payload?.rows) ? payload.rows : []);
      setStats({
        pending: Number(payload?.stats?.pending) || 0,
        approved_open: Number(payload?.stats?.approved_open) || 0,
        rejected: Number(payload?.stats?.rejected) || 0,
        pending_value: Number(payload?.stats?.pending_value) || 0,
      });
    } catch (e) {
      setRows([]);
      setStats({ pending: 0, approved_open: 0, rejected: 0, pending_value: 0 });
      showToast(toFriendlyError(e, "Unable to load pending approvals."), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const hay = [row.name, row.party_name, row.owner].map((v) => String(v || "").toLowerCase()).join(" ");
      return hay.includes(q);
    });
  }, [rows, search]);

  const { page, setPage, resetPage, pageRows: paged, totalPages, total } = usePagedRows(filtered, pageSize);

  const approve = async (name) => {
    if (!name || actionName) return;
    setActionName(name);
    try {
      await prefetchCsrf().catch(() => {});
      const res = await post("/api/method/sales_app.api.quotation.approve_quotation", { name });
      const msg = res?.data?.message || {};
      if (msg?.status && msg.status !== "success") {
        throw new Error(msg.message || "Unable to approve quotation.");
      }
      const openStatus = normStatus(msg?.display_status || msg?.quotation_status) || "Open";
      showToast(`${name} approved — status is ${openStatus} on Quotations.`);
      refreshSalesNotifications();
      await loadDashboard();
    } catch (e) {
      showToast(toFriendlyError(e, "Unable to approve quotation."), "error");
    } finally {
      setActionName("");
    }
  };

  const reject = async () => {
    const name = rejectTarget?.name;
    const reason = String(rejectReason || "").trim();
    if (!name || !reason || actionName) return;
    setActionName(name);
    try {
      await prefetchCsrf().catch(() => {});
      const res = await post("/api/method/sales_app.api.quotation.reject_quotation", { name, reason });
      const msg = res?.data?.message || {};
      if (msg?.status && msg.status !== "success") {
        throw new Error(msg.message || "Unable to reject quotation.");
      }
      setRejectTarget(null);
      setRejectReason("");
      showToast("Quotation rejected.");
      refreshSalesNotifications();
      await loadDashboard();
    } catch (e) {
      showToast(toFriendlyError(e, "Unable to reject quotation."), "error");
    } finally {
      setActionName("");
    }
  };

  const kpiCards = [
    {
      id: "pending",
      label: "Pending approval",
      value: stats.pending,
      sub: "Awaiting your review",
      accent: C.amber,
      icon: "clock",
    },
    {
      id: "value",
      label: "Pending value",
      value: fmtK(stats.pending_value),
      sub: "Grand total in queue",
      accent: C.indigo,
      icon: "sales",
    },
    {
      id: "approved",
      label: "Approved (Open)",
      value: stats.approved_open,
      sub: "Open on Quotations list",
      accent: C.teal,
      icon: "check",
    },
    {
      id: "rejected",
      label: "Rejected",
      value: stats.rejected,
      sub: "Sent back to sales",
      accent: C.red,
      icon: "invoice",
    },
  ];

  return (
    <div className="qt-approvals-page qt-page">
      <SalesToast toast={toast} />

      <section className="qt-kpi-section" aria-label="Approval summary">
        <p className="qt-kpi-section-label">Quotation approvals</p>
        <div className="qt-kpi-grid">
          {kpiCards.map((kpi) => (
            <SalesKpiCard
              key={kpi.id}
              label={kpi.label}
              value={kpi.value}
              sub={kpi.sub}
              accent={kpi.accent}
              icon={kpi.icon}
            />
          ))}
        </div>
      </section>

      {setupHint ? (
        <p className="qt-approvals-setup-hint" role="alert">{setupHint}</p>
      ) : null}

      {!canApproveReject ? (
        <p className="qt-approvals-view-only-hint">
          View-only queue. Only <strong>Sales Manager</strong> can approve or reject quotations.
        </p>
      ) : null}

      <div className="qt-filter-bar">
        <div className="qt-search-wrap">
          <svg className="qt-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            className="qt-search"
            type="search"
            value={search}
            placeholder="Search pending quotation or customer…"
            aria-label="Search pending approvals"
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
          />
        </div>
      </div>

      <div className="qt-card">
        <div className="qt-card-hd">
          <span className="qt-card-title">
            Pending quotations
            {filtered.length ? ` — ${filtered.length}` : ""}
          </span>
          <Link to="/sales/quotations" className="qt-approvals-link">
            View all quotations
          </Link>
        </div>
        <div className="qt-card-body">
          {loading ? (
            <SalesPageLoader label="Loading pending approvals…" />
          ) : filtered.length === 0 ? (
            <SalesEmptyState
              icon={HiOutlineClipboardDocumentCheck}
              title="No quotations pending approval"
              description={
                setupHint
                  ? setupHint
                  : "When a sales executive submits a quotation, it appears here. Older quotations stuck as Draft can be resubmitted from the Quotations list."
              }
            />
          ) : (
            <>
              <div className="sales-table-scroll">
                <table className="pm-table qt-table qt-approvals-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th className="qt-col-id">Quotation</th>
                      <th className="qt-col-customer">Customer</th>
                      <th>Grand Total</th>
                      <th>Submitted By</th>
                      <th>Status</th>
                      {canApproveReject ? <th className="sales-th-center qt-col-actions">Actions</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((row, index) => {
                      const rowIdx = (page - 1) * pageSize + index;
                      const busy = actionName === row.name;
                      const isRejected = normStatus(row?.portal_approval_status).toLowerCase() === "rejected";
                      const canActOnRow = canApproveReject && !isRejected;
                      return (
                        <tr key={row.name} className="qt-row" style={{ "--i": rowIdx }}>
                          <td className="sales-td-muted">{rowIdx + 1}</td>
                          <td className="qt-col-id">
                            <SalesDocumentId id={row.name} />
                          </td>
                          <td className="sales-td-strong qt-col-customer">{row.party_name || "—"}</td>
                          <td className="qt-money">{fmt(row.grand_total)}</td>
                          <td className="sales-td-sub">{row.owner || "—"}</td>
                          <td><Pill status={rowStatus(row)} /></td>
                          {canApproveReject ? (
                          <td className="qt-col-actions">
                            {canActOnRow ? (
                            <div className="qt-approvals-actions">
                              <button
                                type="button"
                                className="qt-approval-act qt-approval-act--approve"
                                disabled={busy}
                                title={busy ? "Approving…" : "Approve quotation"}
                                aria-label={busy ? "Approving quotation" : "Approve quotation"}
                                onClick={() => approve(row.name)}
                              >
                                <HiOutlineCheck size={14} aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="qt-approval-act qt-approval-act--reject"
                                disabled={busy}
                                title="Reject quotation"
                                aria-label="Reject quotation"
                                onClick={() => { setRejectTarget(row); setRejectReason(""); }}
                              >
                                <HiOutlineXMark size={14} aria-hidden />
                              </button>
                            </div>
                            ) : (
                              <span className="sales-td-muted">—</span>
                            )}
                          </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {canApproveReject ? (
              <p className="qt-approvals-note">
                Approving moves the quotation to <strong>Open</strong> on the{" "}
                <Link to="/sales/quotations">Quotations</Link> page.
              </p>
              ) : null}
              <div className="sales-table-pagination">
                <label className="sales-table-pagination__size">
                  <span>Per page</span>
                  <select
                    value={pageSize}
                    aria-label="Rows per page"
                    className="sales-table-pagination__select"
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) {
                        setPageSize(n);
                        resetPage();
                      }
                    }}
                  >
                    {SALES_PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <ListPagination
                  page={page}
                  totalPages={totalPages}
                  total={total}
                  pageSize={pageSize}
                  onPageChange={setPage}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {rejectTarget && canApproveReject ? (
        <SalesDetailModal
          title={`Reject ${rejectTarget.name}`}
          onClose={() => { if (!actionName) { setRejectTarget(null); setRejectReason(""); } }}
          footer={(
            <>
              <button type="button" className="pm-btn pm-btn-ghost qt-btn-ghost" disabled={!!actionName} onClick={() => { setRejectTarget(null); setRejectReason(""); }}>
                Cancel
              </button>
              <button type="button" className="pm-btn pm-btn-primary qt-btn-primary" disabled={!!actionName || !rejectReason.trim()} onClick={reject}>
                {actionName ? "Rejecting…" : "Reject quotation"}
              </button>
            </>
          )}
        >
          <label className="qt-approvals-reject-label">
            Reason
            <textarea
              className="qt-input qt-approvals-reject-input"
              rows={4}
              value={rejectReason}
              placeholder="Why is this quotation being rejected?"
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </label>
        </SalesDetailModal>
      ) : null}
    </div>
  );
}
