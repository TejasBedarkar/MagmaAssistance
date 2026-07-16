import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  HiOutlineArrowPath,
  HiOutlineCheck,
  HiOutlineClipboardDocumentList,
  HiOutlinePlus,
  HiOutlineXMark,
} from "react-icons/hi2";
import api, { prefetchCsrf, toFriendlyError } from "../../lib/apiUtils";
import ListPagination from "../../../../common/components/ListPagination.jsx";
import usePagedRows from "../../../../common/hooks/usePagedRows.js";
import { SALES_PAGE_SIZE_OPTIONS } from "../../lib/pagination.js";
import SalesPageLoader from "../../components/SalesPageLoader.jsx";
import SalesEmptyState from "../../components/SalesEmptyState.jsx";
import SalesDetailModal from "../../components/SalesDetailModal.jsx";
import SalesKpiCard from "../../components/SalesKpiCard.jsx";
import useSalesToast, { SalesToast } from "../../components/useSalesToast.jsx";
import { SALES_COLORS as C } from "../../theme/tokens.js";
import { useSalesAuth } from "../../hooks/useSalesAuth.js";
import { allowedActionsByRole } from "../../lib/roles.js";
import { salesToday, rejectFutureDate } from "../../lib/dateValidation.js";

const fmt = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN")}`;

const STATUS_PILL = {
  complaint: { fg: C.muted, bg: C.surface2 },
  "pending approval": { fg: C.amber, bg: C.amberLt },
  approved: { fg: C.indigo, bg: C.indigoLt },
  "under inspection": { fg: C.teal, bg: C.tealLt },
  "repair in progress": { fg: C.purple, bg: C.purpleLt },
  "replacement issued": { fg: C.blue, bg: C.blueLt },
  "credit note pending": { fg: C.amber, bg: C.amberLt },
  "credit note approved": { fg: C.teal, bg: C.tealLt },
  rejected: { fg: C.red, bg: C.redDim },
  closed: { fg: C.sub, bg: C.surface2 },
};

const WORKFLOW_STEPS = [
  "Complaint",
  "Pending Approval",
  "Approved",
  "Under Inspection",
  "Resolution",
  "Closed",
];

function post(url, data) {
  return api.post(url, data, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    transformRequest: [(payload) => new URLSearchParams(payload).toString()],
  });
}

function normStatus(value) {
  return String(value ?? "").trim();
}

function Pill({ status }) {
  const key = normStatus(status).toLowerCase() || "complaint";
  const theme = STATUS_PILL[key] || { fg: C.sub, bg: C.surface2 };
  return (
    <span className="sales-status-pill" style={{ "--pill-fg": theme.fg, "--pill-bg": theme.bg }}>
      {normStatus(status) || "—"}
    </span>
  );
}

function workflowIndex(status) {
  const st = normStatus(status).toLowerCase();
  if (st === "complaint") return 0;
  if (st === "pending approval") return 1;
  if (st === "approved") return 2;
  if (st === "under inspection") return 3;
  if (
    ["repair in progress", "replacement issued", "credit note pending", "credit note approved"].includes(st)
  ) {
    return 4;
  }
  if (st === "closed" || st === "rejected") return 5;
  return 0;
}

function WorkflowBar({ status }) {
  const active = workflowIndex(status);
  const isRejected = normStatus(status).toLowerCase() === "rejected";
  return (
    <div className="rma-workflow" aria-label="RMA workflow">
      {WORKFLOW_STEPS.map((step, idx) => {
        let cls = "rma-workflow-step";
        if (isRejected && idx === 1) cls += " is-active";
        else if (!isRejected && idx < active) cls += " is-done";
        else if (!isRejected && idx === active) cls += " is-active";
        return (
          <span key={step} className={cls}>
            {step}
          </span>
        );
      })}
    </div>
  );
}

const EMPTY_FORM = {
  customer: "",
  item_code: "",
  qty: "1",
  amount: "",
  sales_order: "",
  delivery_note: "",
  sales_invoice: "",
  complaint_description: "",
  complaint_date: new Date().toISOString().slice(0, 10),
};

export default function Returns() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    complaint: 0,
    pending_approval: 0,
    under_inspection: 0,
    open: 0,
    closed: 0,
    total_amount: 0,
  });
  const [options, setOptions] = useState({ customers: [], items: [], inspection_conditions: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [actionName, setActionName] = useState("");
  const [detail, setDetail] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [inspectionForm, setInspectionForm] = useState({ condition: "", notes: "" });
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const { toast, showToast } = useSalesToast(3200);
  const { salesRole } = useSalesAuth();
  const perms = useMemo(() => allowedActionsByRole(salesRole), [salesRole]);
  const canApproveReject = perms.canApprove && perms.canReject;

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, statsRes, optRes] = await Promise.all([
        api.get("/api/method/sales_app.api.rma.get_rma_list", {
          params: statusFilter ? { status: statusFilter } : {},
        }),
        api.get("/api/method/sales_app.api.rma.dashboard_data"),
        api.get("/api/method/sales_app.api.rma.get_rma_options"),
      ]);
      const list = listRes?.data?.message;
      setRows(Array.isArray(list) ? list : []);
      setStats(statsRes?.data?.message || {});
      setOptions(optRes?.data?.message || { customers: [], items: [] });
    } catch (e) {
      setRows([]);
      showToast(toFriendlyError(e, "Unable to load returns."), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast, statusFilter]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const hay = [
        row.name,
        row.customer_name,
        row.item_code,
        row.item_name,
        row.sales_order,
        row.status,
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [rows, search]);

  const { page, setPage, resetPage, pageRows: paged, totalPages, total } = usePagedRows(filtered, pageSize);

  const openDetail = async (name) => {
    if (!name) return;
    try {
      const res = await api.get("/api/method/sales_app.api.rma.get_rma", { params: { name } });
      const data = res?.data?.message;
      if (!data?.name) throw new Error("RMA not found.");
      setDetail(data);
      setInspectionForm({
        condition: data.inspection_condition || "",
        notes: data.inspection_notes || "",
      });
      setResolutionNotes("");
      setRejectReason("");
    } catch (e) {
      showToast(toFriendlyError(e, "Unable to load RMA."), "error");
    }
  };

  const runAction = async (method, payload = {}, successMsg = "Updated.") => {
    if (actionName) return;
    setActionName(method);
    try {
      await prefetchCsrf().catch(() => {});
      const res = await post(`/api/method/sales_app.api.rma.${method}`, payload);
      const msg = res?.data?.message || {};
      if (msg?.status && msg.status !== "success") {
        throw new Error(msg.message || "Action failed.");
      }
      showToast(msg.message || successMsg);
      setDetail(msg.data || null);
      await loadAll();
      if (msg.data?.name) {
        setDetail(msg.data);
      }
    } catch (e) {
      showToast(toFriendlyError(e, "Action failed."), "error");
    } finally {
      setActionName("");
    }
  };

  const createComplaint = async () => {
    if (!form.customer?.trim()) {
      showToast("Customer is required.", "error");
      return;
    }
    if (actionName) return;
    setActionName("create");
    try {
      await prefetchCsrf().catch(() => {});
      const res = await post("/api/method/sales_app.api.rma.create_rma", {
        customer: form.customer,
        item_code: form.item_code,
        qty: form.qty,
        amount: form.amount,
        sales_order: form.sales_order,
        delivery_note: form.delivery_note,
        sales_invoice: form.sales_invoice,
        complaint_description: form.complaint_description,
        complaint_date: form.complaint_date,
      });
      const msg = res?.data?.message || {};
      if (msg?.status && msg.status !== "success") {
        throw new Error(msg.message || "Unable to create complaint.");
      }
      showToast(`Complaint ${msg.name} created.`);
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      await loadAll();
      if (msg.name) await openDetail(msg.name);
    } catch (e) {
      showToast(toFriendlyError(e, "Unable to create complaint."), "error");
    } finally {
      setActionName("");
    }
  };

  const kpiCards = [
    { id: "open", label: "Open RMAs", value: stats.open || 0, sub: "Active cases", accent: C.amber, icon: "clock" },
    {
      id: "pending",
      label: "Pending approval",
      value: stats.pending_approval || 0,
      sub: "Awaiting manager",
      accent: C.indigo,
      icon: "invoice",
    },
    {
      id: "inspection",
      label: "Inspection queue",
      value: stats.under_inspection || 0,
      sub: "Approved / inspecting",
      accent: C.teal,
      icon: "check",
    },
    {
      id: "amount",
      label: "Return value",
      value: fmt(stats.total_amount),
      sub: "All RMA amounts",
      accent: C.purple,
      icon: "sales",
    },
  ];

  const detailActions = useMemo(() => {
    if (!detail) return null;
    const actions = Array.isArray(detail.allowed_actions) ? detail.allowed_actions : [];
    if (!actions.length) return null;
    const busy = Boolean(actionName);

    const visible = actions.filter((action) => {
      if (["approve", "reject", "approve_credit_note"].includes(action)) {
        return perms.canApprove;
      }
      return true;
    });
    if (!visible.length) return null;

    return (
      <>
        <p className="rma-actions-label">Workflow actions</p>
        <div className="rma-actions">
          {actions.includes("edit") && (
            <button type="button" className="pm-btn pm-btn--secondary" disabled>
              Edit (desk only)
            </button>
          )}
          {actions.includes("submit_for_approval") && (
            <button
              type="button"
              className="pm-btn pm-btn--primary"
              disabled={busy}
              onClick={() => runAction("submit_for_approval", { name: detail.name }, "Submitted for approval.")}
            >
              Submit for approval
            </button>
          )}
          {actions.includes("approve") && perms.canApprove && (
            <button
              type="button"
              className="pm-btn pm-btn--primary"
              disabled={busy}
              onClick={() => runAction("approve_rma", { name: detail.name }, "RMA approved.")}
            >
              <HiOutlineCheck /> Approve
            </button>
          )}
          {actions.includes("reject") && perms.canApprove && (
            <button
              type="button"
              className="pm-btn pm-btn--danger"
              disabled={busy}
              onClick={() => setRejectOpen(true)}
            >
              <HiOutlineXMark /> Reject
            </button>
          )}
          {actions.includes("start_inspection") && (
            <button
              type="button"
              className="pm-btn pm-btn--primary"
              disabled={busy}
              onClick={() => runAction("start_inspection", { name: detail.name }, "Inspection started.")}
            >
              Start inspection
            </button>
          )}
          {actions.includes("resolve_repair") && (
            <button
              type="button"
              className="pm-btn pm-btn--secondary"
              disabled={busy}
              onClick={() =>
                runAction(
                  "resolve_repair",
                  { name: detail.name, service_team_notes: resolutionNotes },
                  "Routed to service team.",
                )
              }
            >
              Repair → Service team
            </button>
          )}
          {actions.includes("resolve_replacement") && (
            <button
              type="button"
              className="pm-btn pm-btn--secondary"
              disabled={busy}
              onClick={() =>
                runAction(
                  "resolve_replacement",
                  { name: detail.name, resolution_notes: resolutionNotes },
                  "Replacement order created.",
                )
              }
            >
              Replacement → Sales order
            </button>
          )}
          {actions.includes("resolve_credit_note") && (
            <button
              type="button"
              className="pm-btn pm-btn--secondary"
              disabled={busy}
              onClick={() =>
                runAction(
                  "resolve_credit_note",
                  { name: detail.name, resolution_notes: resolutionNotes },
                  "Credit note created.",
                )
              }
            >
              Credit note → Finance
            </button>
          )}
          {actions.includes("approve_credit_note") && perms.canApprove && (
            <button
              type="button"
              className="pm-btn pm-btn--primary"
              disabled={busy}
              onClick={() => runAction("approve_credit_note", { name: detail.name }, "Credit note approved.")}
            >
              Approve credit note
            </button>
          )}
          {actions.includes("close") && (
            <button
              type="button"
              className="pm-btn pm-btn--primary"
              disabled={busy}
              onClick={() => runAction("close_rma", { name: detail.name }, "RMA closed.")}
            >
              Close RMA
            </button>
          )}
        </div>
      </>
    );
  }, [detail, actionName, perms.canApprove, resolutionNotes]);

  return (
    <div className="rma-page">
      <SalesToast toast={toast} />

      <div className="rma-head">
        <div>
          <h1 className="rma-title">Return management (RMA)</h1>
          <p className="rma-subtitle">
            Complaint → approval → inspection → repair, replacement, or credit note
          </p>
        </div>
        <div className="rma-toolbar">
          <button type="button" className="pm-btn pm-btn--secondary" onClick={loadAll} disabled={loading}>
            <HiOutlineArrowPath /> Refresh
          </button>
          <button type="button" className="pm-btn pm-btn--primary" onClick={() => setCreateOpen(true)}>
            <HiOutlinePlus /> New complaint
          </button>
        </div>
      </div>

      <section className="rma-kpi-section" aria-label="RMA summary">
        <p className="rma-kpi-section-label">Return overview</p>
        <div className="rma-kpi-grid">
          {kpiCards.map((card) => (
            <SalesKpiCard key={card.id} {...card} />
          ))}
        </div>
      </section>

      {canApproveReject ? (
        <p className="rma-hint rma-hint--manager">
          <strong>Sales Manager:</strong> Open an RMA or use <strong>Approve</strong> on pending rows below.
        </p>
      ) : (
        <p className="rma-hint">
          Submit complaints for manager approval. Inspection and resolution steps are available after approval.
        </p>
      )}

      <div className="rma-filter-bar">
        <div className="rma-search-wrap">
          <svg className="rma-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            className="rma-search"
            placeholder="Search RMA, customer, item…"
            aria-label="Search return requests"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPage();
            }}
          />
        </div>
        <select
          className="rma-filter-select"
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            resetPage();
          }}
        >
          <option value="">All statuses</option>
          {(options.statuses || []).map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>
      </div>

      <section className="rma-card">
        <div className="rma-card-hd">
          <h2 className="rma-card-title">
            Return requests
            {filtered.length ? ` — ${filtered.length}` : ""}
          </h2>
        </div>
        <div className="rma-card-body">
          {loading ? (
            <SalesPageLoader label="Loading returns…" />
          ) : !paged.length ? (
            <SalesEmptyState
              icon={HiOutlineClipboardDocumentList}
              title="No return requests"
              hint="Create a complaint to start the RMA workflow."
            />
          ) : (
            <>
              <div className="rma-table-scroll">
                <table className="rma-table">
                  <thead>
                    <tr>
                      <th>RMA</th>
                      <th>Date</th>
                      <th>Customer</th>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Resolution</th>
                      {canApproveReject ? <th className="rma-th-actions">Actions</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((row, index) => {
                      const rowIdx = (page - 1) * pageSize + index;
                      const isPending = normStatus(row.status).toLowerCase() === "pending approval";
                      const busy = actionName === row.name;
                      return (
                        <tr key={row.name} className="rma-row" style={{ "--i": rowIdx }}>
                          <td>
                            <button type="button" className="rma-id-link" onClick={() => openDetail(row.name)}>
                              {row.name}
                            </button>
                          </td>
                          <td className="rma-td-muted">{row.complaint_date || "—"}</td>
                          <td className="rma-td-customer">{row.customer_name || row.customer}</td>
                          <td>{row.item_name || row.item_code || "—"}</td>
                          <td className="rma-td-muted">{row.qty ?? "—"}</td>
                          <td className="rma-td-money">{fmt(row.amount)}</td>
                          <td>
                            <Pill status={row.status} />
                          </td>
                          <td className="rma-td-muted">{row.resolution || "—"}</td>
                          {canApproveReject ? (
                            <td>
                              <div className="rma-row-actions">
                                {isPending ? (
                                  <>
                                    <button
                                      type="button"
                                      className="pm-btn pm-btn--primary"
                                      disabled={busy}
                                      onClick={() => runAction("approve_rma", { name: row.name }, "RMA approved.")}
                                    >
                                      <HiOutlineCheck /> Approve
                                    </button>
                                    <button
                                      type="button"
                                      className="pm-btn pm-btn--danger"
                                      disabled={busy}
                                      onClick={() => {
                                        openDetail(row.name);
                                        setRejectOpen(true);
                                      }}
                                    >
                                      <HiOutlineXMark /> Reject
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    className="pm-btn pm-btn--secondary"
                                    onClick={() => openDetail(row.name)}
                                  >
                                    View
                                  </button>
                                )}
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ListPagination
                page={page}
                totalPages={totalPages}
                total={total}
                pageSize={pageSize}
                pageSizeOptions={SALES_PAGE_SIZE_OPTIONS}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  resetPage();
                }}
              />
            </>
          )}
        </div>
      </section>

      {createOpen && (
        <SalesDetailModal
          title="New complaint"
          onClose={() => setCreateOpen(false)}
          form
          rma
          footer={(
            <>
              <button type="button" className="pm-btn pm-btn--secondary" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="pm-btn pm-btn--primary"
                disabled={actionName === "create"}
                onClick={createComplaint}
              >
                Create complaint
              </button>
            </>
          )}
        >
          <div className="rma-form-grid">
            <label>
              Customer *
              <select
                value={form.customer}
                onChange={(e) => setForm((f) => ({ ...f, customer: e.target.value }))}
              >
                <option value="">Select customer</option>
                {(options.customers || []).map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Complaint date
              <input
                type="date"
                value={form.complaint_date}
                max={salesToday()}
                onChange={(e) => setForm((f) => ({ ...f, complaint_date: rejectFutureDate(e.target.value) }))}
              />
            </label>
            <label>
              Item
              <select
                value={form.item_code}
                onChange={(e) => {
                  const code = e.target.value;
                  const item = (options.items || []).find((i) => i.code === code);
                  setForm((f) => ({
                    ...f,
                    item_code: code,
                    amount: item?.rate ? String(item.rate) : f.amount,
                  }));
                }}
              >
                <option value="">Select item (optional)</option>
                {(options.items || []).map((i) => (
                  <option key={i.code} value={i.code}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Quantity
              <input
                type="number"
                min="1"
                step="1"
                value={form.qty}
                onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))}
              />
            </label>
            <label>
              Return amount (₹)
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </label>
            <label>
              Sales order
              <input
                value={form.sales_order}
                onChange={(e) => setForm((f) => ({ ...f, sales_order: e.target.value }))}
                placeholder="SO-..."
              />
            </label>
            <label className="rma-form-field--full">
              Complaint description
              <textarea
                value={form.complaint_description}
                onChange={(e) => setForm((f) => ({ ...f, complaint_description: e.target.value }))}
                placeholder="Describe the issue…"
              />
            </label>
          </div>
        </SalesDetailModal>
      )}

      {detail && (
        <SalesDetailModal
          title={detail.name}
          wide
          rma
          onClose={() => setDetail(null)}
          footer={(
            <button type="button" className="pm-btn pm-btn--secondary" onClick={() => setDetail(null)}>
              Close
            </button>
          )}
        >
          <WorkflowBar status={detail.status} />
          <p className="rma-detail-stage">
            Stage: <strong>{detail.workflow_stage || detail.status}</strong>
          </p>

          <div className="rma-detail-panel">
            <h3 className="rma-detail-panel-title">Return details</h3>
            <div className="rma-detail-grid">
            <div className="rma-field">
              <span className="rma-field-label">Status</span>
              <span className="rma-field-value">
                <Pill status={detail.status} />
              </span>
            </div>
            <div className="rma-field">
              <span className="rma-field-label">Complaint date</span>
              <span className="rma-field-value">{detail.complaint_date || "—"}</span>
            </div>
            <div className="rma-field">
              <span className="rma-field-label">Customer</span>
              <span className="rma-field-value">{detail.customer_name || detail.customer}</span>
            </div>
            <div className="rma-field">
              <span className="rma-field-label">Item</span>
              <span className="rma-field-value">
                {detail.item_name || detail.item_code || "—"} ({detail.qty})
              </span>
            </div>
            <div className="rma-field">
              <span className="rma-field-label">Amount</span>
              <span className="rma-field-value">{fmt(detail.amount)}</span>
            </div>
            <div className="rma-field">
              <span className="rma-field-label">Sales order</span>
              <span className="rma-field-value">
                {detail.sales_order ? (
                  <Link className="rma-link" to="/sales/orders">
                    {detail.sales_order}
                  </Link>
                ) : (
                  "—"
                )}
              </span>
            </div>
            <div className="rma-field rma-field--full">
              <span className="rma-field-label">Complaint</span>
              <span className="rma-field-value">{detail.complaint_description || "—"}</span>
            </div>
            {detail.inspection_condition && (
              <div className="rma-field">
                <span className="rma-field-label">Inspection</span>
                <span className="rma-field-value">{detail.inspection_condition}</span>
              </div>
            )}
            {detail.inspection_notes && (
              <div className="rma-field rma-field--full">
                <span className="rma-field-label">Inspection notes</span>
                <span className="rma-field-value">{detail.inspection_notes}</span>
              </div>
            )}
            {detail.linked_replacement_order && (
              <div className="rma-field">
                <span className="rma-field-label">Replacement SO</span>
                <span className="rma-field-value">
                  <Link className="rma-link" to="/sales/orders">
                    {detail.linked_replacement_order}
                  </Link>
                </span>
              </div>
            )}
            {detail.linked_credit_note && (
              <div className="rma-field">
                <span className="rma-field-label">Credit note</span>
                <span className="rma-field-value">{detail.linked_credit_note}</span>
              </div>
            )}
            </div>
          </div>

          {detail.status === "Under Inspection" && (
            <div className="rma-inspection-panel">
              <h3 className="rma-inspection-panel-title">Material inspection</h3>
              <div className="rma-form-grid">
              <label>
                Inspection condition
                <select
                  value={inspectionForm.condition}
                  onChange={(e) => setInspectionForm((f) => ({ ...f, condition: e.target.value }))}
                >
                  <option value="">Select…</option>
                  {(options.inspection_conditions || []).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="rma-form-field--full">
                Inspection notes
                <textarea
                  value={inspectionForm.notes}
                  onChange={(e) => setInspectionForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>
              <button
                type="button"
                className="pm-btn pm-btn--secondary"
                disabled={Boolean(actionName)}
                onClick={() =>
                  runAction("complete_inspection", {
                    name: detail.name,
                    inspection_condition: inspectionForm.condition,
                    inspection_notes: inspectionForm.notes,
                  })
                }
              >
                Save inspection
              </button>
              <label className="rma-form-field--full">
                Resolution notes (optional)
                <textarea
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                />
              </label>
              </div>
            </div>
          )}

          {detailActions}
        </SalesDetailModal>
      )}

      {rejectOpen && detail && (
        <SalesDetailModal
          title="Reject RMA"
          rma
          onClose={() => setRejectOpen(false)}
          footer={(
            <>
              <button type="button" className="pm-btn pm-btn--secondary" onClick={() => setRejectOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="pm-btn pm-btn--danger"
                disabled={!rejectReason.trim() || Boolean(actionName)}
                onClick={async () => {
                  await runAction("reject_rma", { name: detail.name, reason: rejectReason }, "RMA rejected.");
                  setRejectOpen(false);
                }}
              >
                Reject
              </button>
            </>
          )}
        >
          <label className="rma-reject-label">
            Reason
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          </label>
        </SalesDetailModal>
      )}
    </div>
  );
}
