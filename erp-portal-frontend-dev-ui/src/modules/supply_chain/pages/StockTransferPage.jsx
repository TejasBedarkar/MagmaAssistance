import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftRight, CheckCircle, FileEdit, Warehouse } from "lucide-react";
import toast from "react-hot-toast";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import useScmList from "../hooks/useScmList.js";
import useScmDocDeepLink from "../hooks/useScmDocDeepLink.js";
import {
  cancelStockTransfer,
  checkStockTransferAvailability,
  createStockTransfer,
  getStockTransfer,
  getStockTransferFormOptions,
  listStockTransfers,
  submitStockTransfer,
} from "../api/stockTransfer.js";
import ScmPageHeader from "../components/ScmPageHeader.jsx";
import ScmDataTable from "../components/ScmDataTable.jsx";
import ScmKpiCard from "../components/ScmKpiCard.jsx";
import ScmPageKpiGrid from "../components/ScmPageKpiGrid.jsx";
import ScmPanel from "../components/ScmPanel.jsx";
import ScmQuickLinks from "../components/ScmQuickLinks.jsx";
import ScmStatusBadge from "../components/ScmStatusBadge.jsx";
import ScmModal from "../components/ScmModal.jsx";
import { ScmDetailField } from "../components/ScmDetailPanel.jsx";
import { countWhere, distinctCount } from "../utils/scmPageHelpers.js";

const EMPTY_FORM = {
  from_warehouse: "",
  to_warehouse: "",
  item_code: "",
  qty: 1,
  submit_doc: true,
};

function availabilityMessage(check, itemCode, qty) {
  if (!check?.lines?.length) return "";
  const line = check.lines.find((l) => l.item_code === itemCode) || check.lines[0];
  if (!line) return "";
  if (check.all_available) {
    return `${itemCode}: ${line.available_qty} available at source — ready to transfer ${qty}.`;
  }
  return `${itemCode}: only ${line.available_qty} available at source (need ${qty}). Pick the warehouse that holds stock — check Stock page.`;
}

export default function StockTransferPage() {
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [options, setOptions] = useState({ warehouses: [], items: [] });
  const [availability, setAvailability] = useState(null);
  const [checkingStock, setCheckingStock] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);

  const { rows, loading, error, updated, reload } = useScmList(
    () => listStockTransfers({ limit: 200, include_draft: 1 }),
    [],
  );

  useEffect(() => {
    getStockTransferFormOptions()
      .then(setOptions)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!showForm || !form.from_warehouse || !form.item_code) {
      setAvailability(null);
      return;
    }
    const qty = Number(form.qty) || 0;
    if (qty <= 0) {
      setAvailability(null);
      return;
    }
    setCheckingStock(true);
    const timer = setTimeout(() => {
      checkStockTransferAvailability(form.from_warehouse, [{ item_code: form.item_code, qty }])
        .then(setAvailability)
        .catch(() => setAvailability(null))
        .finally(() => setCheckingStock(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [showForm, form.from_warehouse, form.item_code, form.qty]);

  const kpis = useMemo(
    () => ({
      total: rows.length,
      draft: countWhere(rows, (r) => r.docstatus === 0),
      submitted: countWhere(rows, (r) => r.docstatus === 1),
      fromWarehouses: distinctCount(rows, "from_warehouse"),
    }),
    [rows],
  );

  const { page, setPage, totalPages, pageRows, total } = usePagedRows(rows, 25);

  const openRow = useCallback(async (row) => {
    setSelected(row.name);
    setDetail(null);
    setLoadingDetail(true);
    try {
      setDetail(await getStockTransfer(row.name));
    } catch {
      toast.error("Could not load transfer.");
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

  useScmDocDeepLink("transfer", rows, openRow);

  const closeCreateModal = () => {
    setShowForm(false);
    setForm(EMPTY_FORM);
    setAvailability(null);
  };

  const canCreate =
    form.from_warehouse &&
    form.to_warehouse &&
    form.from_warehouse !== form.to_warehouse &&
    form.item_code &&
    Number(form.qty) > 0 &&
    availability?.all_available;

  const submitCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const items = [{ item_code: form.item_code, qty: Number(form.qty) }];
      const check = await checkStockTransferAvailability(form.from_warehouse, items);
      if (!check.all_available) {
        const line = check.lines?.[0];
        toast.error(
          line
            ? `Insufficient stock at ${form.from_warehouse}: ${line.available_qty} available, need ${line.required_qty}.`
            : `Insufficient stock at ${form.from_warehouse}.`,
        );
        setAvailability(check);
        return;
      }
      const result = await createStockTransfer({
        from_warehouse: form.from_warehouse,
        to_warehouse: form.to_warehouse,
        items,
        submit_doc: form.submit_doc ? 1 : 0,
        validate_stock: 1,
      });
      const name = result?.stock_transfer?.name || result?.name;
      toast.success(name ? `Stock transfer ${name} created.` : "Stock transfer created.");
      setShowForm(false);
      setForm(EMPTY_FORM);
      setAvailability(null);
      await reload();
      if (name) {
        openRow({ name });
      }
    } catch (err) {
      toast.error(err?.message || "Create failed.");
    } finally {
      setSaving(false);
    }
  };

  const cancelTransfer = async () => {
    if (!detail?.name) return;
    setActing(true);
    try {
      await cancelStockTransfer(detail.name);
      toast.success("Transfer cancelled.");
      closeModal();
      reload();
    } catch (err) {
      toast.error(err?.message || "Cancel failed.");
    } finally {
      setActing(false);
    }
  };

  const submitDraft = async () => {
    if (!detail?.name || detail.docstatus !== 0) return;
    setActing(true);
    try {
      const result = await submitStockTransfer(detail.name);
      setDetail(result.stock_transfer || detail);
      toast.success("Transfer submitted.");
      reload();
    } catch (err) {
      toast.error(err?.message || "Submit failed.");
    } finally {
      setActing(false);
    }
  };

  const columns = [
    { key: "name", header: "Transfer", className: "scm-table__cell--link" },
    { key: "posting_date", header: "Date" },
    { key: "from_warehouse", header: "From" },
    { key: "to_warehouse", header: "To" },
    {
      key: "status",
      header: "Status",
      render: (r) => <ScmStatusBadge status={r.status || "Draft"} />,
    },
  ];

  const availabilityHint =
    form.from_warehouse && form.item_code
      ? availabilityMessage(availability, form.item_code, Number(form.qty) || 0)
      : "";

  return (
    <div className="scm-page scm-stock-transfer-page">
      <ScmPageHeader
        title="Stock Transfer"
        subtitle="Inter-warehouse material transfers"
        updated={updated}
        loading={loading}
        actions={
          <>
            <ScmQuickLinks
              links={[
                { to: "/supply-chain/inventory", label: "Stock" },
                { to: "/supply-chain/warehouses", label: "Warehouses" },
                { to: "/supply-chain/grn", label: "GRN" },
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
          label="Transfers"
          value={kpis.total}
          sub="All documents"
          icon={<ArrowLeftRight size={16} />}
        />
        <ScmKpiCard
          label="Draft"
          value={kpis.draft}
          sub="Docstatus 0"
          tone="warn"
          icon={<FileEdit size={16} />}
        />
        <ScmKpiCard
          label="Submitted"
          value={kpis.submitted}
          sub="Docstatus 1"
          tone="default"
          icon={<CheckCircle size={16} />}
        />
        <ScmKpiCard
          label="From warehouses"
          value={kpis.fromWarehouses}
          sub="Distinct source locations"
          icon={<Warehouse size={16} />}
        />
      </ScmPageKpiGrid>

      <ScmPanel
        title="Move stock"
        subtitle="Transfer material between warehouses — availability checked before create"
        className="scm-stock-transfer-action-panel"
      >
        <div className="scm-page-action-form">
          <button
            type="button"
            className="scm-btn-primary scm-reservations-action-btn"
            onClick={() => setShowForm(true)}
          >
            New transfer
          </button>
        </div>
        <p className="scm-page-hint scm-page-hint--muted">
          Stock must exist at the <strong>From warehouse</strong> (e.g. after GRN into Stores).{" "}
          <Link to="/supply-chain/inventory" className="scm-link-btn--sm">Check Stock</Link> first.
        </p>
      </ScmPanel>

      {error ? <div className="scm-error-banner">{error}</div> : null}

      <ScmDataTable
        columns={columns}
        rows={pageRows}
        loading={loading}
        emptyIcon={ArrowLeftRight}
        emptyTitle="No transfers"
        emptyDescription="Create a material transfer between warehouses."
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
        title={detail?.name || selected || "Stock Transfer"}
        subtitle={
          detail
            ? `${detail.from_warehouse} → ${detail.to_warehouse}`
            : "Loading…"
        }
        wide
        onClose={closeModal}
        footer={
          <>
            <button type="button" className="scm-btn-ghost" onClick={closeModal}>
              Close
            </button>
            {detail?.docstatus === 0 ? (
              <button type="button" className="scm-btn-primary" disabled={acting} onClick={submitDraft}>
                Submit
              </button>
            ) : null}
            {detail && detail.docstatus !== 2 ? (
              <button type="button" className="scm-btn-ghost" disabled={acting} onClick={cancelTransfer}>
                Cancel transfer
              </button>
            ) : null}
          </>
        }
      >
        {loadingDetail ? (
          <p className="scm-modal-loading">Loading transfer…</p>
        ) : detail ? (
          <>
            <div className="scm-detail-grid">
              <ScmDetailField label="Date" value={detail.posting_date} />
              <ScmDetailField label="Status" value={detail.status} />
              <ScmDetailField label="From" value={detail.from_warehouse} />
              <ScmDetailField label="To" value={detail.to_warehouse} />
            </div>
            <div className="scm-table-scroll">
              <table className="scm-table">
                <thead>
                  <tr className="scm-table__row">
                    {["Item", "Qty", "UOM"].map((h) => (
                      <th key={h} className="scm-table__head">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(detail.items || []).map((item) => (
                    <tr key={item.item_code} className="scm-table__row">
                      <td className="scm-table__cell scm-table__cell--strong">{item.item_code}</td>
                      <td className="scm-table__cell">{item.qty}</td>
                      <td className="scm-table__cell">{item.uom}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </ScmModal>

      <ScmModal
        open={showForm}
        title="Create stock transfer"
        subtitle="Inter-warehouse material transfer"
        wide
        onClose={closeCreateModal}
        footer={
          <>
            <button type="button" className="scm-btn-ghost" onClick={closeCreateModal} disabled={saving}>
              Cancel
            </button>
            <button
              type="submit"
              form="scm-create-transfer-form"
              className="scm-btn-primary"
              disabled={saving || checkingStock || !canCreate}
              title={!canCreate ? "Select warehouses, item, and ensure stock is available at source" : ""}
            >
              {saving ? "Saving…" : "Create transfer"}
            </button>
          </>
        }
      >
        <form id="scm-create-transfer-form" onSubmit={submitCreate}>
          <div className="scm-form-grid">
            <label className="scm-form-field">
              <span className="scm-form-label">From warehouse *</span>
              <select
                className="scm-input"
                value={form.from_warehouse}
                onChange={(e) => setForm((f) => ({ ...f, from_warehouse: e.target.value }))}
                required
              >
                <option value="">Select…</option>
                {options.warehouses.map((w) => (
                  <option key={w.name} value={w.name}>{w.name}</option>
                ))}
              </select>
            </label>
            <label className="scm-form-field">
              <span className="scm-form-label">To warehouse *</span>
              <select
                className="scm-input"
                value={form.to_warehouse}
                onChange={(e) => setForm((f) => ({ ...f, to_warehouse: e.target.value }))}
                required
              >
                <option value="">Select…</option>
                {options.warehouses
                  .filter((w) => w.name !== form.from_warehouse)
                  .map((w) => (
                    <option key={w.name} value={w.name}>{w.name}</option>
                  ))}
              </select>
            </label>
            <label className="scm-form-field">
              <span className="scm-form-label">Item *</span>
              <select
                className="scm-input"
                value={form.item_code}
                onChange={(e) => setForm((f) => ({ ...f, item_code: e.target.value }))}
                required
              >
                <option value="">Select…</option>
                {options.items.map((i) => (
                  <option key={i.name} value={i.name}>{i.name} — {i.item_name}</option>
                ))}
              </select>
            </label>
            <label className="scm-form-field">
              <span className="scm-form-label">Qty *</span>
              <input
                className="scm-input"
                type="number"
                min="0.001"
                step="any"
                value={form.qty}
                onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))}
                required
              />
            </label>
          </div>
          {checkingStock ? (
            <p className="scm-page-hint" style={{ marginTop: "0.75rem" }}>Checking stock at source…</p>
          ) : availabilityHint ? (
            <p
              className={availability?.all_available ? "scm-page-hint" : "scm-error-banner"}
              style={{ marginTop: "0.75rem" }}
            >
              {availabilityHint}
            </p>
          ) : form.from_warehouse && form.item_code ? null : (
            <p className="scm-page-hint" style={{ marginTop: "0.75rem" }}>
              Select <strong>From warehouse</strong> and <strong>Item</strong> to see available qty.
            </p>
          )}
          <label className="scm-form-field" style={{ marginTop: "0.75rem" }}>
            <input
              type="checkbox"
              checked={form.submit_doc}
              onChange={(e) => setForm((f) => ({ ...f, submit_doc: e.target.checked }))}
            />
            {" "}
            <span className="scm-form-label">Submit immediately</span>
          </label>
        </form>
      </ScmModal>
    </div>
  );
}
