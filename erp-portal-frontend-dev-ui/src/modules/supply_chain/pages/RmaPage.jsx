import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle, ClipboardCheck, Clock, RotateCcw } from "lucide-react";
import toast from "react-hot-toast";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import useDebouncedValue from "../hooks/useDebouncedValue.js";
import useScmList from "../hooks/useScmList.js";
import useScmDocDeepLink from "../hooks/useScmDocDeepLink.js";
import {
  completeRma,
  createReturnRequest,
  getReturnRequest,
  inspectReturn,
  listReturnRequests,
  receiveReturnToWarehouse,
} from "../api/rma.js";
import { getStockTransferFormOptions } from "../api/stockTransfer.js";
import ScmPageHeader from "../components/ScmPageHeader.jsx";
import ScmPageKpiGrid from "../components/ScmPageKpiGrid.jsx";
import ScmQuickLinks from "../components/ScmQuickLinks.jsx";
import ScmListFilters from "../components/ScmListFilters.jsx";
import ScmDataTable from "../components/ScmDataTable.jsx";
import ScmStatusBadge from "../components/ScmStatusBadge.jsx";
import ScmKpiCard from "../components/ScmKpiCard.jsx";
import ScmPanel from "../components/ScmPanel.jsx";
import ScmModal from "../components/ScmModal.jsx";
import { ScmDetailField } from "../components/ScmDetailPanel.jsx";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "Open", label: "Open" },
  { value: "In Progress", label: "In Progress" },
  { value: "Closed", label: "Closed" },
];

const INSPECTION_OPTIONS = ["Repair", "Replacement", "Credit_Note"];
const EMPTY_CREATE = { item_code: "", qty: 1, reason: "", customer_id: "", sales_order_id: "", complaint_description: "" };

export default function RmaPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_CREATE);
  const [inspection, setInspection] = useState({ result: "Repair", remarks: "" });
  const [warehouse, setWarehouse] = useState("");
  const [warehouses, setWarehouses] = useState([]);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);

  const { rows, loading, error, updated, reload } = useScmList(
    () => listReturnRequests({ search: debouncedSearch || undefined, status: status || undefined, limit: 200 }),
    [debouncedSearch, status],
  );

  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(rows, 25);

  const kpis = useMemo(() => {
    let open = 0;
    let inProgress = 0;
    let closed = 0;
    let pendingInspection = 0;
    for (const r of rows) {
      if (r.status === "Open") open += 1;
      else if (r.status === "In Progress") inProgress += 1;
      else if (r.status === "Closed") closed += 1;
      if (!r.inspection_result && r.status !== "Closed") pendingInspection += 1;
    }
    return { open, inProgress, closed, pendingInspection };
  }, [rows]);

  useEffect(() => {
    getStockTransferFormOptions()
      .then((opts) => {
        setWarehouses(opts.warehouses || []);
        if (opts.warehouses?.[0]?.name) setWarehouse(opts.warehouses[0].name);
      })
      .catch(() => {});
  }, []);

  const refreshDetail = useCallback(async (rmaId) => {
    const id = rmaId || detail?.rma_id;
    if (!id) return;
    setDetail(await getReturnRequest(id));
  }, [detail?.rma_id]);

  const openRow = useCallback(async (row) => {
    const id = row.name || row.rma_id;
    setSelected(id);
    setDetail(null);
    setLoadingDetail(true);
    try {
      setDetail(await getReturnRequest(id));
    } catch {
      toast.error("Could not load RMA.");
      setSelected(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const closeModal = useCallback(() => {
    setDetail(null);
    setSelected(null);
    setLoadingDetail(false);
  }, []);

  useScmDocDeepLink("rma", rows, openRow);

  const submitCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createReturnRequest({
        sales_order_id: form.sales_order_id || undefined,
        customer_id: form.customer_id || undefined,
        complaint_description: form.complaint_description,
        items: [{ item_code: form.item_code, qty: form.qty, reason: form.reason }],
      });
      toast.success("Return request created.");
      setShowForm(false);
      setForm(EMPTY_CREATE);
      reload();
    } catch (err) {
      toast.error(err?.message || "Create failed.");
    } finally {
      setSaving(false);
    }
  };

  const runInspect = async () => {
    if (!detail?.rma_id) return;
    setActing(true);
    try {
      await inspectReturn(detail.rma_id, {
        inspection_result: inspection.result,
        inspection_remarks: inspection.remarks,
      });
      await refreshDetail(detail.rma_id);
      toast.success("Inspection recorded.");
      reload();
    } catch (err) {
      toast.error(err?.message || "Inspection failed.");
    } finally {
      setActing(false);
    }
  };

  const runReceive = async () => {
    if (!detail?.rma_id || !warehouse) return;
    setActing(true);
    try {
      await receiveReturnToWarehouse(detail.rma_id, warehouse, 1);
      await refreshDetail(detail.rma_id);
      toast.success("Return received to warehouse.");
    } catch (err) {
      toast.error(err?.message || "Receive failed.");
    } finally {
      setActing(false);
    }
  };

  const runComplete = async () => {
    if (!detail?.rma_id) return;
    setActing(true);
    try {
      const res = await completeRma(detail.rma_id, warehouse || undefined);
      setDetail(res.rma || res);
      toast.success("RMA completed.");
      reload();
    } catch (err) {
      toast.error(err?.message || "Complete failed.");
    } finally {
      setActing(false);
    }
  };

  const columns = [
    { key: "name", header: "RMA #", className: "scm-table__cell--link" },
    { key: "customer", header: "Customer", className: "scm-table__cell--strong" },
    { key: "sales_order", header: "Sales order" },
    { key: "complaint_date", header: "Date" },
    { key: "status", header: "Status", render: (r) => <ScmStatusBadge status={r.status} /> },
    {
      key: "inspection_result",
      header: "Inspection",
      render: (r) => (r.inspection_result ? <ScmStatusBadge status={r.inspection_result} /> : "—"),
    },
  ];

  return (
    <div className="scm-page scm-rma-page">
      <ScmPageHeader
        title="Returns (RMA)"
        subtitle="Customer returns — inspect, receive stock, replacement or credit note"
        updated={updated}
        loading={loading}
        actions={
          <>
            <ScmQuickLinks
              links={[
                { to: "/supply-chain/inventory", label: "Stock" },
                { to: "/supply-chain/stock-transfer", label: "Stock transfer" },
                { to: "/supply-chain/reservations", label: "Reservations" },
              ]}
            />
            <button type="button" className="scm-btn-ghost" onClick={reload} disabled={loading}>
              Refresh
            </button>
          </>
        }
      />

      <ScmPageKpiGrid>
        <ScmKpiCard
          label="Open"
          value={kpis.open}
          sub="Awaiting inspection or receipt"
          tone="warn"
          icon={<RotateCcw size={16} />}
        />
        <ScmKpiCard
          label="In progress"
          value={kpis.inProgress}
          sub="Inspection or warehouse steps"
          icon={<Clock size={16} />}
        />
        <ScmKpiCard
          label="Closed"
          value={kpis.closed}
          sub="Repair, replacement, or credit note"
          tone="success"
          icon={<CheckCircle size={16} />}
        />
        <ScmKpiCard
          label="Pending inspection"
          value={kpis.pendingInspection}
          sub="No inspection result yet"
          tone="danger"
          icon={<ClipboardCheck size={16} />}
        />
      </ScmPageKpiGrid>

      <div className="scm-page-two-col">
        <ScmPanel
          title="Register customer return"
          subtitle="Create a return request — link to sales order when available"
          className="scm-rma-action-panel"
        >
          <div className="scm-page-action-form">
            <button
              type="button"
              className="scm-btn-primary scm-page-action-btn"
              onClick={() => setShowForm(true)}
            >
              New RMA
            </button>
          </div>
        </ScmPanel>
      </div>

      <ScmListFilters
        search={search}
        onSearchChange={(v) => { setSearch(v); resetPage(); }}
        searchPlaceholder="Search RMA, customer, SO…"
        selectLabel="Status"
        selectValue={status}
        selectOptions={STATUS_OPTIONS}
        onSelectChange={(v) => { setStatus(v); resetPage(); }}
      />

      {error ? <div className="scm-error-banner">{error}</div> : null}

      <ScmDataTable
        columns={columns}
        rows={pageRows}
        loading={loading}
        emptyIcon={RotateCcw}
        emptyTitle="No return requests"
        emptyDescription="Customer returns appear here after creation."
        getRowKey={(r) => r.name}
        activeKey={selected}
        onRowClick={openRow}
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={25}
        onPageChange={setPage}
      />

      <ScmModal
        open={Boolean(selected)}
        title={detail?.rma_id || selected || "RMA"}
        subtitle={detail?.customer || "Loading…"}
        wide
        onClose={closeModal}
        footer={
          detail && !loadingDetail && detail.status !== "Closed" ? (
            <>
              <button type="button" className="scm-btn-ghost" onClick={closeModal}>Close</button>
              <button type="button" className="scm-btn-ghost" disabled={acting} onClick={runReceive}>Receive stock</button>
              <button type="button" className="scm-btn-primary" disabled={acting} onClick={runComplete}>Complete RMA</button>
            </>
          ) : (
            <button type="button" className="scm-btn-ghost" onClick={closeModal}>Close</button>
          )
        }
      >
        {loadingDetail ? (
          <p className="scm-modal-loading">Loading RMA…</p>
        ) : detail ? (
          <>
            <div className="scm-detail-grid">
              <ScmDetailField label="Status" value={detail.status} />
              <ScmDetailField label="Inspection" value={detail.inspection_result || "—"} />
              <ScmDetailField label="Sales order" value={detail.sales_order || "—"} />
              <ScmDetailField label="Credit note" value={detail.credit_note_id || "—"} />
            </div>
            <div className="scm-table-scroll">
              <table className="scm-table">
                <thead>
                  <tr className="scm-table__row">
                    {["Item", "Qty", "Reason"].map((h) => (
                      <th key={h} className="scm-table__head">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(detail.items || []).map((item) => (
                    <tr key={item.item_code} className="scm-table__row">
                      <td className="scm-table__cell scm-table__cell--strong">{item.item_code}</td>
                      <td className="scm-table__cell">{item.qty}</td>
                      <td className="scm-table__cell">{item.reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detail.status !== "Closed" ? (
              <div className="scm-form-grid" style={{ marginTop: "1rem" }}>
                <label className="scm-form-field">
                  <span className="scm-form-label">Inspection result</span>
                  <select className="scm-input" value={inspection.result} onChange={(e) => setInspection((s) => ({ ...s, result: e.target.value }))}>
                    {INSPECTION_OPTIONS.map((o) => (
                      <option key={o} value={o}>{o.replace("_", " ")}</option>
                    ))}
                  </select>
                </label>
                <label className="scm-form-field">
                  <span className="scm-form-label">Receive warehouse</span>
                  <select className="scm-input" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
                    {warehouses.map((w) => (
                      <option key={w.name} value={w.name}>{w.name}</option>
                    ))}
                  </select>
                </label>
                <label className="scm-form-field scm-form-field--full">
                  <span className="scm-form-label">Remarks</span>
                  <input className="scm-input" value={inspection.remarks} onChange={(e) => setInspection((s) => ({ ...s, remarks: e.target.value }))} />
                </label>
                <button type="button" className="scm-btn-primary" disabled={acting} onClick={runInspect}>Save inspection</button>
              </div>
            ) : null}
            {detail.credit_note_id && !detail.credit_note_id.startsWith("CN-PENDING") ? (
              <p className="scm-mock-notice" style={{ marginTop: "0.75rem" }}>
                <Link to={`/finance/sales-invoices?si=${encodeURIComponent(detail.credit_note_id)}`} className="scm-link-btn--sm">
                  View credit note in Finance
                </Link>
              </p>
            ) : null}
          </>
        ) : null}
      </ScmModal>

      <ScmModal
        open={showForm}
        title="Create return request"
        subtitle="Link to sales order when available"
        onClose={() => setShowForm(false)}
        footer={
          <>
            <button type="button" className="scm-btn-ghost" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
            <button type="submit" form="scm-create-rma-form" className="scm-btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Create RMA"}
            </button>
          </>
        }
      >
        <form id="scm-create-rma-form" onSubmit={submitCreate}>
          <div className="scm-form-grid">
            <label className="scm-form-field">
              <span className="scm-form-label">Item code</span>
              <input className="scm-input" value={form.item_code} onChange={(e) => setForm((f) => ({ ...f, item_code: e.target.value }))} required />
            </label>
            <label className="scm-form-field">
              <span className="scm-form-label">Qty</span>
              <input type="number" min="1" className="scm-input" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: Number(e.target.value) }))} required />
            </label>
            <label className="scm-form-field">
              <span className="scm-form-label">Customer (optional)</span>
              <input className="scm-input" value={form.customer_id} onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))} />
            </label>
            <label className="scm-form-field">
              <span className="scm-form-label">Sales order (optional)</span>
              <input className="scm-input" value={form.sales_order_id} onChange={(e) => setForm((f) => ({ ...f, sales_order_id: e.target.value }))} />
            </label>
            <label className="scm-form-field scm-form-field--full">
              <span className="scm-form-label">Complaint</span>
              <input className="scm-input" value={form.complaint_description} onChange={(e) => setForm((f) => ({ ...f, complaint_description: e.target.value }))} />
            </label>
          </div>
        </form>
      </ScmModal>
    </div>
  );
}
