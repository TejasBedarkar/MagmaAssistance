import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FileEdit, IndianRupee, Package, ShoppingCart } from "lucide-react";
import toast from "react-hot-toast";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import useDebouncedValue from "../hooks/useDebouncedValue.js";
import useScmList from "../hooks/useScmList.js";
import useScmDocDeepLink from "../hooks/useScmDocDeepLink.js";
import {
  getPurchaseOrder,
  listPurchaseOrders,
  submitPurchaseOrder,
} from "../api/purchaseOrders.js";
import { createGrnFromPurchaseOrder } from "../api/grn.js";
import ScmPageHeader from "../components/ScmPageHeader.jsx";
import ScmListFilters from "../components/ScmListFilters.jsx";
import ScmDataTable from "../components/ScmDataTable.jsx";
import ScmStatusBadge from "../components/ScmStatusBadge.jsx";
import ScmKpiCard from "../components/ScmKpiCard.jsx";
import ScmPanel from "../components/ScmPanel.jsx";
import ScmQuickLinks from "../components/ScmQuickLinks.jsx";
import ScmModal from "../components/ScmModal.jsx";
import { ScmDetailField } from "../components/ScmDetailPanel.jsx";

const CLOSED_STATUSES = new Set(["Closed", "Cancelled", "Completed"]);

const fmtInr = (n) =>
  `₹ ${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const QUICK_LINKS = [
  { to: "/supply-chain/material-requests", label: "Material requests" },
  { to: "/supply-chain/grn", label: "GRN" },
  { to: "/supply-chain/suppliers", label: "Suppliers" },
];

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [acting, setActing] = useState(false);

  const { rows, loading, error, updated, reload } = useScmList(
    () => listPurchaseOrders({ search: debouncedSearch || undefined, limit: 200 }),
    [debouncedSearch],
  );

  const filtered = useMemo(() => rows, [rows]);
  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(filtered, 25);

  const kpis = useMemo(() => {
    const openRows = rows.filter((r) => !CLOSED_STATUSES.has(r.status));
    const partialRows = rows.filter(
      (r) => !CLOSED_STATUSES.has(r.status) && Number(r.per_received || 0) < 100,
    );
    const draftRows = rows.filter((r) => Number(r.docstatus) === 0);
    const totalValue = rows.reduce((sum, r) => sum + Number(r.grand_total || 0), 0);
    return {
      openCount: openRows.length,
      partialCount: partialRows.length,
      draftCount: draftRows.length,
      totalValue,
    };
  }, [rows]);

  const openRow = useCallback(async (row) => {
    setSelected(row.name);
    setDetail(null);
    setLoadingDetail(true);
    try {
      setDetail(await getPurchaseOrder(row.name));
    } catch {
      toast.error("Could not load purchase order.");
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

  useScmDocDeepLink("po", rows, openRow);

  const canCreateGrn =
    detail &&
    detail.docstatus === 1 &&
    Number(detail.per_received || 0) < 100 &&
    !CLOSED_STATUSES.has(detail.status);

  const submitPo = async () => {
    if (!detail?.name) return;
    setActing(true);
    try {
      const result = await submitPurchaseOrder(detail.name);
      setDetail(result.purchase_order || result);
      toast.success("Purchase order submitted.");
      reload();
    } catch (err) {
      toast.error(err?.message || "Submit failed.");
    } finally {
      setActing(false);
    }
  };

  const createGrn = async () => {
    if (!detail?.name) return;
    setActing(true);
    try {
      const result = await createGrnFromPurchaseOrder(detail.name);
      toast.success(`GRN ${result.name || ""} created.`);
      closeModal();
      reload();
      if (result.name) {
        navigate(`/supply-chain/grn?grn=${encodeURIComponent(result.name)}`);
      }
    } catch (err) {
      toast.error(err?.message || "Could not create GRN.");
    } finally {
      setActing(false);
    }
  };

  const columns = [
    { key: "name", header: "PO #", className: "scm-table__cell--link" },
    { key: "supplier_name", header: "Supplier", className: "scm-table__cell--strong" },
    { key: "transaction_date", header: "Date" },
    {
      key: "status",
      header: "Status",
      render: (r) => <ScmStatusBadge status={r.status} />,
    },
    {
      key: "grand_total",
      header: "Total",
      render: (r) => fmtInr(r.grand_total),
    },
    {
      key: "per_received",
      header: "Received %",
      render: (r) => `${Number(r.per_received || 0).toFixed(0)}%`,
    },
  ];

  return (
    <div className="scm-page scm-purchase-orders-page">
      <ScmPageHeader
        title="Purchase Orders"
        subtitle="Procurement documents — create from Material Requests"
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
          label="Open POs"
          value={kpis.openCount}
          sub="Not closed, cancelled, or completed"
          tone="warn"
          icon={<Package size={16} />}
        />
        <ScmKpiCard
          label="Partial receipt"
          value={kpis.partialCount}
          sub="Received below 100%"
          tone="warn"
          icon={<ShoppingCart size={16} />}
        />
        <ScmKpiCard
          label="Draft POs"
          value={kpis.draftCount}
          sub="Awaiting submission"
          icon={<FileEdit size={16} />}
        />
        <ScmKpiCard
          label="Total value"
          value={fmtInr(kpis.totalValue)}
          sub={`${rows.length} purchase order${rows.length === 1 ? "" : "s"}`}
          icon={<IndianRupee size={16} />}
        />
      </div>

      <div className="scm-page-two-col">
        <ScmPanel
          title="Create purchase order"
          subtitle="Raise POs from submitted material requests"
        >
          <p className="scm-page-hint">
            Open a material request and use <strong>Create PO</strong> on the detail view.{" "}
            <Link to="/supply-chain/material-requests" className="scm-link-btn--sm">
              Browse material requests
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
        searchPlaceholder="Search PO or supplier…"
      />

      {error ? <div className="scm-error-banner">{error}</div> : null}

      <ScmDataTable
        columns={columns}
        rows={pageRows}
        loading={loading}
        emptyIcon={ShoppingCart}
        emptyTitle="No purchase orders"
        emptyDescription="Create POs from open material requests."
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
        title={detail?.name || selected || "Purchase Order"}
        subtitle={detail?.supplier_name || detail?.supplier || "Loading…"}
        wide
        onClose={closeModal}
        footer={
          detail && !loadingDetail ? (
            <>
              <button type="button" className="scm-btn-ghost" onClick={closeModal}>
                Close
              </button>
              {detail.linked_material_request ? (
                <Link
                  to={`/supply-chain/material-requests?mr=${encodeURIComponent(detail.linked_material_request)}`}
                  className="scm-btn-ghost"
                >
                  View MR
                </Link>
              ) : null}
              {detail.docstatus === 0 ? (
                <button type="button" className="scm-btn-primary" disabled={acting} onClick={submitPo}>
                  {acting ? "Submitting…" : "Submit PO"}
                </button>
              ) : null}
              {canCreateGrn ? (
                <button type="button" className="scm-btn-primary" disabled={acting} onClick={createGrn}>
                  {acting ? "Creating…" : "Create GRN"}
                </button>
              ) : null}
            </>
          ) : (
            <button type="button" className="scm-btn-ghost" onClick={closeModal}>
              Close
            </button>
          )
        }
      >
        {loadingDetail ? (
          <p className="scm-modal-loading">Loading purchase order…</p>
        ) : detail ? (
          <>
            <div className="scm-detail-grid">
              <ScmDetailField label="Status" value={detail.status} />
              <ScmDetailField label="Total" value={fmtInr(detail.grand_total)} />
              <ScmDetailField
                label="Linked MR"
                value={
                  detail.linked_material_request ? (
                    <Link
                      to={`/supply-chain/material-requests?mr=${encodeURIComponent(detail.linked_material_request)}`}
                      className="scm-link-btn--sm"
                    >
                      {detail.linked_material_request}
                    </Link>
                  ) : (
                    "—"
                  )
                }
              />
              <ScmDetailField label="Received" value={`${detail.per_received || 0}%`} />
            </div>
            <div className="scm-table-scroll">
              <table className="scm-table">
                <thead>
                  <tr className="scm-table__row">
                    {["Item", "Qty", "Rate", "Amount"].map((h) => (
                      <th key={h} className="scm-table__head">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(detail.items || []).map((item) => (
                    <tr key={item.item_code} className="scm-table__row">
                      <td className="scm-table__cell scm-table__cell--strong">{item.item_code}</td>
                      <td className="scm-table__cell">{item.qty}</td>
                      <td className="scm-table__cell">{item.rate}</td>
                      <td className="scm-table__cell">{item.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </ScmModal>
    </div>
  );
}
