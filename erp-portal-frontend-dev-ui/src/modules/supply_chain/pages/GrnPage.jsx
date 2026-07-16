import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Clock, Inbox, Loader, XCircle } from "lucide-react";
import toast from "react-hot-toast";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import useDebouncedValue from "../hooks/useDebouncedValue.js";
import useScmList from "../hooks/useScmList.js";
import useScmDocDeepLink from "../hooks/useScmDocDeepLink.js";
import {
  createGrnFromPurchaseOrder,
  getGrn,
  listGrns,
  processRejectedMaterial,
  updateGrnReceipt,
  updateInspectionStatus,
} from "../api/grn.js";
import { putawayGrn, recordGrnInspection } from "../api/quality.js";
import { listWarehouses } from "../api/warehouses.js";
import ScmPageHeader from "../components/ScmPageHeader.jsx";
import ScmListFilters from "../components/ScmListFilters.jsx";
import ScmDataTable from "../components/ScmDataTable.jsx";
import ScmStatusBadge from "../components/ScmStatusBadge.jsx";
import ScmKpiCard from "../components/ScmKpiCard.jsx";
import ScmPanel from "../components/ScmPanel.jsx";
import ScmQuickLinks from "../components/ScmQuickLinks.jsx";
import ScmModal from "../components/ScmModal.jsx";
import { ScmDetailField } from "../components/ScmDetailPanel.jsx";

const INSPECTION_STATES = ["Pending", "In Progress", "Accepted", "Partial", "Rejected"];

const INSPECTION_OPTIONS = [
  { value: "", label: "All inspection" },
  ...INSPECTION_STATES.map((s) => ({ value: s, label: s })),
];

const QUICK_LINKS = [
  { to: "/supply-chain/purchase-orders", label: "Purchase orders" },
  { to: "/supply-chain/inventory", label: "Stock" },
  { to: "/supply-chain/warehouses", label: "Warehouses" },
];

const fmtInr = (n) =>
  `₹ ${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

function buildLineDraft(detail) {
  return (detail?.items || []).map((line) => ({
    item_code: line.item_code,
    batch_no: line.batch_no || "",
    rack: line.rack || "",
    bin: line.bin || "",
    warehouse: line.warehouse || "",
    accepted_qty: line.accepted_qty ?? line.qty ?? 0,
    rejected_qty: line.rejected_qty ?? 0,
  }));
}

function inspectionStatus(row) {
  return row.inspection_status || "Pending";
}

export default function GrnPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [inspectionFilter, setInspectionFilter] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [lineDraft, setLineDraft] = useState([]);
  const [headerDraft, setHeaderDraft] = useState({ plant: "", received_by: "", vehicle_lr_no: "" });
  const [rejectWarehouse, setRejectWarehouse] = useState("");
  const [warehouses, setWarehouses] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    listWarehouses().then(setWarehouses).catch(() => setWarehouses([]));
  }, []);

  const { rows, loading, error, updated, reload } = useScmList(
    () => listGrns({ search: debouncedSearch || undefined, limit: 200 }),
    [debouncedSearch],
  );

  const filtered = useMemo(() => {
    if (!inspectionFilter) return rows;
    return rows.filter((r) => inspectionStatus(r) === inspectionFilter);
  }, [rows, inspectionFilter]);

  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(filtered, 25);

  const kpis = useMemo(() => {
    const counts = {
      pending: 0,
      inProgress: 0,
      acceptedPartial: 0,
      rejected: 0,
    };
    for (const row of rows) {
      const status = inspectionStatus(row);
      if (status === "Pending") counts.pending += 1;
      else if (status === "In Progress") counts.inProgress += 1;
      else if (status === "Accepted" || status === "Partial") counts.acceptedPartial += 1;
      else if (status === "Rejected") counts.rejected += 1;
    }
    return counts;
  }, [rows]);

  const applyDetail = useCallback((grn) => {
    setDetail(grn);
    setLineDraft(buildLineDraft(grn));
    setHeaderDraft({
      plant: grn.plant || "",
      received_by: grn.received_by || "",
      vehicle_lr_no: grn.vehicle_lr_no || "",
    });
    setRejectWarehouse(grn.reject_warehouse || "");
  }, []);

  const openRow = useCallback(async (row) => {
    setSelected(row.name);
    setDetail(null);
    setLoadingDetail(true);
    try {
      applyDetail(await getGrn(row.name));
    } catch {
      toast.error("Could not load GRN.");
      setSelected(null);
    } finally {
      setLoadingDetail(false);
    }
  }, [applyDetail]);

  const closeModal = useCallback(() => {
    setDetail(null);
    setSelected(null);
    setLineDraft([]);
    setLoadingDetail(false);
    if (searchParams.get("grn")) {
      const next = new URLSearchParams(searchParams);
      next.delete("grn");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useScmDocDeepLink("grn", rows, openRow);

  const updateInspection = async (status) => {
    if (!detail?.name) return;
    setActing(true);
    try {
      const result = await updateInspectionStatus(detail.name, status, rejectWarehouse || undefined);
      applyDetail(result.grn || detail);
      toast.success(`Inspection set to ${status}.`);
      reload();
      if (status === "Accepted") {
        closeModal();
      }
    } catch (err) {
      toast.error(err?.message || "Update failed.");
    } finally {
      setActing(false);
    }
  };

  const saveReceipt = async () => {
    if (!detail?.name) return;
    setActing(true);
    try {
      const result = await updateGrnReceipt(detail.name, {
        plant: headerDraft.plant || undefined,
        received_by: headerDraft.received_by || undefined,
        vehicle_lr_no: headerDraft.vehicle_lr_no || undefined,
        lines: lineDraft,
      });
      applyDetail(result.grn || detail);
      toast.success("Receipt details saved.");
    } catch (err) {
      toast.error(err?.message || "Save failed.");
    } finally {
      setActing(false);
    }
  };

  const runPutaway = async () => {
    if (!detail?.name) return;
    setActing(true);
    try {
      const result = await putawayGrn(detail.name);
      applyDetail(await getGrn(detail.name));
      toast.success(`Putaway complete (${result.allocations?.length || 0} lines).`);
    } catch (err) {
      toast.error(err?.message || "Putaway failed.");
    } finally {
      setActing(false);
    }
  };

  const acceptAllLines = async () => {
    if (!detail?.name) return;
    if (detail.inspection_status === "Accepted") {
      toast.success("GRN accepted. Stock is booked.");
      closeModal();
      reload();
      return;
    }
    setActing(true);
    try {
      await updateGrnReceipt(detail.name, {
        plant: headerDraft.plant || undefined,
        received_by: headerDraft.received_by || undefined,
        vehicle_lr_no: headerDraft.vehicle_lr_no || undefined,
        lines: lineDraft.map((line) => ({
          ...line,
          accepted_qty: line.accepted_qty ?? (detail.items || []).find((i) => i.item_code === line.item_code)?.qty ?? 0,
          rejected_qty: 0,
        })),
      });
      const items = (detail.items || []).map((line) => ({
        item_code: line.item_code,
        status: "Accepted",
        qty: line.qty,
      }));
      await recordGrnInspection(detail.name, { items });
      await updateInspectionStatus(detail.name, "Accepted", rejectWarehouse || undefined);
      closeModal();
      toast.success("All lines accepted. Inspection set to Accepted.");
      await reload();
    } catch (err) {
      toast.error(err?.message || "Inspection failed.");
    } finally {
      setActing(false);
    }
  };

  const runVendorReturn = async () => {
    if (!detail?.name) return;
    setActing(true);
    try {
      const result = await processRejectedMaterial(detail.name, rejectWarehouse || undefined);
      applyDetail(result.grn || detail);
      toast.success("Rejected material flagged for vendor return.");
      reload();
    } catch (err) {
      toast.error(err?.message || "Vendor return failed.");
    } finally {
      setActing(false);
    }
  };

  const patchLine = (itemCode, field, value) => {
    setLineDraft((rows) =>
      rows.map((row) => (row.item_code === itemCode ? { ...row, [field]: value } : row)),
    );
  };

  const canPutaway =
    detail && ["Accepted", "Partial"].includes(detail.inspection_status || "Pending");

  const inspectionComplete = detail?.inspection_status === "Accepted";

  const hasRejected = lineDraft.some((l) => Number(l.rejected_qty) > 0);

  const columns = [
    { key: "name", header: "GRN #", className: "scm-table__cell--link" },
    { key: "supplier", header: "Supplier", className: "scm-table__cell--strong" },
    { key: "posting_date", header: "Date" },
    {
      key: "inspection_status",
      header: "Inspection",
      render: (r) => <ScmStatusBadge status={inspectionStatus(r)} />,
    },
    {
      key: "grand_total",
      header: "Total",
      render: (r) => fmtInr(r.grand_total),
    },
  ];

  return (
    <div className="scm-page scm-grn-page">
      <ScmPageHeader
        title="GRN"
        subtitle="Goods receipt, inspection, putaway, and vendor return (PDF §4 / UC-10)"
        updated={updated}
        loading={loading}
        actions={
          <>
            <ScmQuickLinks links={QUICK_LINKS} />
            <button type="button" className="scm-btn-ghost" onClick={reload} disabled={loading}>
              Refresh
            </button>
          </>
        }
      />

      <div className="scm-page-kpi-grid">
        <ScmKpiCard
          label="Pending inspection"
          value={kpis.pending}
          sub="Awaiting QC"
          tone="warn"
          icon={<Clock size={16} />}
        />
        <ScmKpiCard
          label="In progress"
          value={kpis.inProgress}
          sub="Inspection underway"
          tone="warn"
          icon={<Loader size={16} />}
        />
        <ScmKpiCard
          label="Accepted / partial"
          value={kpis.acceptedPartial}
          sub="Ready for putaway"
          icon={<CheckCircle2 size={16} />}
        />
        <ScmKpiCard
          label="Rejected"
          value={kpis.rejected}
          sub="Vendor return queue"
          tone="danger"
          icon={<XCircle size={16} />}
        />
      </div>

      <div className="scm-page-two-col">
        <ScmPanel
          title="Receive against PO"
          subtitle="Create GRNs from submitted purchase orders"
        >
          <p className="scm-page-hint">
            Open a submitted PO and use <strong>Create GRN</strong> on the detail view.{" "}
            <Link to="/supply-chain/purchase-orders" className="scm-link-btn--sm">
              Browse purchase orders
            </Link>
          </p>
        </ScmPanel>
      </div>

      <ScmListFilters
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          resetPage();
        }}
        searchPlaceholder="Search GRN or supplier…"
        selectLabel="Inspection"
        selectValue={inspectionFilter}
        selectOptions={INSPECTION_OPTIONS}
        onSelectChange={(v) => {
          setInspectionFilter(v);
          resetPage();
        }}
      />

      {error ? <div className="scm-error-banner">{error}</div> : null}

      <ScmDataTable
        columns={columns}
        rows={pageRows}
        loading={loading}
        emptyIcon={Inbox}
        emptyTitle="No GRNs"
        emptyDescription="Create GRNs from submitted purchase orders."
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
        title={detail?.name || selected || "GRN"}
        subtitle={detail?.supplier || "Loading…"}
        wide
        onClose={closeModal}
        footer={
          detail && !loadingDetail ? (
            <>
              <button type="button" className="scm-btn-ghost" onClick={closeModal}>
                Close
              </button>
              <button type="button" className="scm-btn-ghost" disabled={acting} onClick={saveReceipt}>
                Save receipt
              </button>
              <button type="button" className="scm-btn-primary" disabled={acting} onClick={acceptAllLines}>
                {inspectionComplete ? "Done" : "Accept all"}
              </button>
              <button
                type="button"
                className="scm-btn-ghost"
                disabled={acting || !canPutaway}
                title={canPutaway ? "Run putaway" : "Accept inspection first"}
                onClick={runPutaway}
              >
                Putaway
              </button>
              <button
                type="button"
                className="scm-btn-ghost"
                disabled={acting || !hasRejected}
                onClick={runVendorReturn}
              >
                Vendor return
              </button>
            </>
          ) : (
            <button type="button" className="scm-btn-ghost" onClick={closeModal}>
              Close
            </button>
          )
        }
      >
        {loadingDetail ? (
          <p className="scm-modal-loading">Loading GRN…</p>
        ) : detail ? (
          <>
            <div className="scm-detail-grid">
              <ScmDetailField label="Date" value={detail.posting_date} />
              <ScmDetailField label="Status" value={detail.status} />
              <ScmDetailField label="Inspection" value={detail.inspection_status} />
              <ScmDetailField label="Vendor return" value={detail.vendor_return_status || "—"} />
              <ScmDetailField label="Total" value={fmtInr(detail.grand_total)} />
            </div>
            <div className="scm-form-grid" style={{ marginTop: "1rem" }}>
              <label className="scm-form-field">
                <span className="scm-form-label">Inspection status</span>
                <select
                  className="scm-input"
                  value={detail.inspection_status || "Pending"}
                  disabled={acting}
                  onChange={(e) => updateInspection(e.target.value)}
                >
                  {INSPECTION_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            {inspectionComplete ? (
              <p className="scm-page-hint" style={{ marginTop: "0.75rem" }}>
                Inspection complete. Stock was booked when this GRN was submitted. Use{" "}
                <strong>Putaway</strong> for rack/bin allocation, or check{" "}
                <Link to="/supply-chain/inventory" className="scm-link-btn--sm">Inventory</Link>.
              </p>
            ) : (
              <p className="scm-page-hint" style={{ marginTop: "0.75rem" }}>
                Use <strong>Accept all</strong> to accept every line and set inspection to Accepted in one step.
              </p>
            )}
            <h4 className="scm-detail-section-title">Receipt (plant, batch, rack/bin)</h4>
            <div className="scm-form-grid">
              {[
                ["plant", "Plant"],
                ["received_by", "Received by"],
                ["vehicle_lr_no", "Vehicle / LR no"],
              ].map(([key, label]) => (
                <label key={key} className="scm-form-field">
                  <span className="scm-form-label">{label}</span>
                  <input
                    className="scm-input"
                    value={headerDraft[key]}
                    onChange={(e) => setHeaderDraft((h) => ({ ...h, [key]: e.target.value }))}
                  />
                </label>
              ))}
              <label className="scm-form-field">
                <span className="scm-form-label">Reject warehouse</span>
                <input
                  className="scm-input"
                  value={rejectWarehouse}
                  onChange={(e) => setRejectWarehouse(e.target.value)}
                  placeholder="REJ-WH01"
                />
              </label>
            </div>
            <div className="scm-table-scroll">
              <table className="scm-table scm-table--wide">
                <thead>
                  <tr className="scm-table__row">
                    {["Item", "Qty", "Batch", "WH", "Rack", "Bin", "Accepted", "Rejected"].map((h) => (
                      <th key={h} className="scm-table__head">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lineDraft.map((line) => (
                    <tr key={line.item_code} className="scm-table__row">
                      <td className="scm-table__cell scm-table__cell--strong">{line.item_code}</td>
                      <td className="scm-table__cell">
                        {(detail.items || []).find((i) => i.item_code === line.item_code)?.qty}
                      </td>
                      <td className="scm-table__cell">
                        <input
                          className="scm-input"
                          value={line.batch_no}
                          onChange={(e) => patchLine(line.item_code, "batch_no", e.target.value)}
                        />
                      </td>
                      <td className="scm-table__cell">
                        {warehouses.length > 0 ? (
                          <select
                            className="scm-input"
                            value={line.warehouse}
                            onChange={(e) => patchLine(line.item_code, "warehouse", e.target.value)}
                          >
                            <option value="">Select warehouse…</option>
                            {warehouses.map((w) => (
                              <option key={w.name} value={w.name}>{w.name}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="scm-input"
                            value={line.warehouse}
                            onChange={(e) => patchLine(line.item_code, "warehouse", e.target.value)}
                            placeholder="Stores - MD"
                          />
                        )}
                      </td>
                      <td className="scm-table__cell">
                        <input
                          className="scm-input"
                          value={line.rack}
                          onChange={(e) => patchLine(line.item_code, "rack", e.target.value)}
                        />
                      </td>
                      <td className="scm-table__cell">
                        <input
                          className="scm-input"
                          value={line.bin}
                          onChange={(e) => patchLine(line.item_code, "bin", e.target.value)}
                        />
                      </td>
                      <td className="scm-table__cell">
                        <input
                          className="scm-input"
                          type="number"
                          value={line.accepted_qty}
                          onChange={(e) => patchLine(line.item_code, "accepted_qty", e.target.value)}
                        />
                      </td>
                      <td className="scm-table__cell">
                        <input
                          className="scm-input"
                          type="number"
                          value={line.rejected_qty}
                          onChange={(e) => patchLine(line.item_code, "rejected_qty", e.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(detail.bin_allocation || []).length > 0 ? (
              <>
                <h4 className="scm-detail-section-title">Putaway allocation</h4>
                <ul className="scm-detail-list">
                  {detail.bin_allocation.map((row) => (
                    <li key={`${row.item_code}-${row.warehouse}`}>
                      {row.item_code} @ {row.warehouse}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        ) : null}
      </ScmModal>
    </div>
  );
}

export { createGrnFromPurchaseOrder };
