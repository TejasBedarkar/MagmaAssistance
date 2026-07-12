import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FileEdit, FileSearch, Link2, Send } from "lucide-react";
import toast from "react-hot-toast";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import useDebouncedValue from "../hooks/useDebouncedValue.js";
import useScmList from "../hooks/useScmList.js";
import {
  awardSupplierQuotation,
  compareQuotations,
  createRfqFromMaterialRequest,
  getRfq,
  listRfqs,
  submitRfq,
} from "../api/rfq.js";
import ScmPageHeader from "../components/ScmPageHeader.jsx";
import ScmListFilters from "../components/ScmListFilters.jsx";
import ScmDataTable from "../components/ScmDataTable.jsx";
import ScmKpiCard from "../components/ScmKpiCard.jsx";
import ScmPageKpiGrid from "../components/ScmPageKpiGrid.jsx";
import ScmPanel from "../components/ScmPanel.jsx";
import ScmQuickLinks from "../components/ScmQuickLinks.jsx";
import ScmStatusBadge from "../components/ScmStatusBadge.jsx";
import ScmModal from "../components/ScmModal.jsx";
import { ScmDetailField } from "../components/ScmDetailPanel.jsx";
import { countWhere } from "../utils/scmPageHelpers.js";

export default function RfqPage() {
  const [searchParams] = useSearchParams();
  const mrFilter = searchParams.get("mr") || "";

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [acting, setActing] = useState(false);

  const { rows, loading, error, updated, reload } = useScmList(
    () =>
      listRfqs({
        search: debouncedSearch || undefined,
        material_request: mrFilter || undefined,
        limit: 200,
      }),
    [debouncedSearch, mrFilter],
  );

  const kpis = useMemo(
    () => ({
      total: rows.length,
      draft: countWhere(rows, (r) => r.docstatus === 0),
      sent: countWhere(rows, (r) => r.docstatus === 1),
      withMr: countWhere(rows, (r) => r.linked_material_request),
    }),
    [rows],
  );

  const filtered = useMemo(() => rows, [rows]);
  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(filtered, 25);

  const openRow = useCallback(async (row) => {
    setSelected(row.name);
    setDetail(null);
    setComparison(null);
    setLoadingDetail(true);
    try {
      const [rfq, cmp] = await Promise.all([
        getRfq(row.name),
        compareQuotations(row.name).catch(() => null),
      ]);
      setDetail(rfq);
      setComparison(cmp);
    } catch {
      toast.error("Could not load RFQ.");
      setSelected(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const closeModal = () => {
    setDetail(null);
    setComparison(null);
    setSelected(null);
    setLoadingDetail(false);
  };

  const sendRfq = async () => {
    if (!detail?.name) return;
    setActing(true);
    try {
      const res = await submitRfq(detail.name);
      setDetail(res.rfq || res);
      toast.success("RFQ sent to vendors.");
      reload();
    } catch (err) {
      toast.error(err?.message || "Submit failed.");
    } finally {
      setActing(false);
    }
  };

  const awardQuote = async (supplierQuotation) => {
    if (!supplierQuotation) return;
    setActing(true);
    try {
      const res = await awardSupplierQuotation(supplierQuotation, 1);
      toast.success(`PO ${res.purchase_order} created from awarded quote.`);
      closeModal();
      reload();
    } catch (err) {
      toast.error(err?.message || "Award failed.");
    } finally {
      setActing(false);
    }
  };

  const createFromMr = async () => {
    if (!mrFilter) return;
    setActing(true);
    try {
      const res = await createRfqFromMaterialRequest({
        material_request: mrFilter,
        suggested_suppliers_only: 1,
        submit_doc: 0,
      });
      toast.success(`RFQ ${res.rfq?.name || ""} created.`);
      reload();
      if (res.rfq?.name) openRow({ name: res.rfq.name });
    } catch (err) {
      toast.error(err?.message || "Could not create RFQ.");
    } finally {
      setActing(false);
    }
  };

  const columns = [
    { key: "name", header: "RFQ", className: "scm-table__cell--link" },
    {
      key: "scm_status",
      header: "Status",
      render: (r) => <ScmStatusBadge status={r.scm_status || (r.docstatus === 1 ? "Sent" : "Draft")} />,
    },
    {
      key: "linked_material_request",
      header: "MR",
      render: (r) =>
        r.linked_material_request ? (
          <Link
            to={`/supply-chain/material-requests?mr=${encodeURIComponent(r.linked_material_request)}`}
            className="scm-link-btn--sm"
            onClick={(e) => e.stopPropagation()}
          >
            {r.linked_material_request}
          </Link>
        ) : (
          "—"
        ),
    },
    { key: "transaction_date", header: "Date" },
  ];

  return (
    <div className="scm-page scm-rfq-page">
      <ScmPageHeader
        title="Request for Quotation"
        subtitle="Vendor RFQ, quote comparison, and PO award (PDF §4)"
        updated={updated}
        loading={loading}
        actions={
          <>
            <ScmQuickLinks
              links={[
                { to: "/supply-chain/material-requests", label: "MR" },
                { to: "/supply-chain/purchase-orders", label: "PO" },
                { to: "/supply-chain/suppliers", label: "Suppliers" },
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
          label="RFQs"
          value={kpis.total}
          sub="All vendor quotations"
          icon={<FileSearch size={16} />}
        />
        <ScmKpiCard
          label="Draft"
          value={kpis.draft}
          sub="Docstatus 0"
          tone="warn"
          icon={<FileEdit size={16} />}
        />
        <ScmKpiCard
          label="Sent"
          value={kpis.sent}
          sub="Docstatus 1"
          icon={<Send size={16} />}
        />
        <ScmKpiCard
          label="Linked to MR"
          value={kpis.withMr}
          sub="With material request"
          icon={<Link2 size={16} />}
        />
      </ScmPageKpiGrid>

      <ScmPanel
        title="Vendor quotation"
        subtitle="Create RFQ from an open material request and send to suppliers"
        className="scm-rfq-action-panel"
      >
        <div className="scm-page-action-form">
          {mrFilter ? (
            <button
              type="button"
              className="scm-btn-primary scm-reservations-action-btn"
              disabled={acting}
              onClick={createFromMr}
            >
              {acting ? "Creating…" : "Create RFQ from MR"}
            </button>
          ) : (
            <Link to="/supply-chain/material-requests" className="scm-btn-primary scm-reservations-action-btn">
              Browse material requests
            </Link>
          )}
        </div>
        {mrFilter ? (
          <p className="scm-page-hint">
            Linked MR: <strong>{mrFilter}</strong>{" "}
            <Link to="/supply-chain/rfq" className="scm-link-btn--sm">
              Clear filter
            </Link>
          </p>
        ) : (
          <p className="scm-page-hint scm-page-hint--muted">
            Open an MR and use Create RFQ, or add <code>?mr=MAT-MR-…</code> to this URL.
          </p>
        )}
      </ScmPanel>

      <ScmListFilters
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          resetPage();
        }}
        searchPlaceholder="Search RFQ…"
      />

      {error ? <div className="scm-error-banner">{error}</div> : null}

      <ScmDataTable
        columns={columns}
        rows={pageRows}
        loading={loading}
        emptyIcon={FileSearch}
        emptyTitle="No RFQs"
        emptyDescription="Create an RFQ from a material request to send to vendors."
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
        title={detail?.name || selected || "RFQ"}
        subtitle={detail?.scm_status || "Loading…"}
        wide
        onClose={closeModal}
        footer={
          detail && !loadingDetail ? (
            <>
              <button type="button" className="scm-btn-ghost" onClick={closeModal}>Close</button>
              {detail.docstatus === 0 ? (
                <button type="button" className="scm-btn-primary" disabled={acting} onClick={sendRfq}>
                  Send RFQ
                </button>
              ) : null}
            </>
          ) : (
            <button type="button" className="scm-btn-ghost" onClick={closeModal}>Close</button>
          )
        }
      >
        {loadingDetail ? (
          <p className="scm-modal-loading">Loading…</p>
        ) : detail ? (
          <>
            <div className="scm-detail-grid">
              <ScmDetailField
                label="MR"
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
              <ScmDetailField label="Company" value={detail.company} />
              <ScmDetailField label="Schedule date" value={detail.schedule_date} />
            </div>
            {(detail.items || []).length > 0 ? (
              <div className="scm-detail-table-wrap">
                <table className="scm-detail-table">
                  <thead>
                    <tr><th>Item</th><th>Qty</th></tr>
                  </thead>
                  <tbody>
                    {detail.items.map((line) => (
                      <tr key={line.item_code || line.name}>
                        <td>{line.item_code}</td>
                        <td>{line.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {(detail.suppliers || []).length > 0 ? (
              <>
                <h4 className="scm-detail-section-title">Vendors</h4>
                <ul className="scm-detail-list">
                  {detail.suppliers.map((s) => (
                    <li key={s.supplier}>{s.supplier_name || s.supplier}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {comparison?.comparison?.length ? (
              <>
                <h4 className="scm-detail-section-title">Quote comparison</h4>
                <div className="scm-detail-table-wrap">
                  <table className="scm-detail-table">
                    <thead>
                      <tr>
                        <th>Supplier</th>
                        <th>Total</th>
                        <th>Lead days</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.comparison.map((row) => (
                        <tr key={row.supplier_quotation || row.supplier}>
                          <td>{row.supplier_name || row.supplier}</td>
                          <td>{row.grand_total}</td>
                          <td>{row.lead_time_days ?? "—"}</td>
                          <td>
                            {row.supplier_quotation ? (
                              <button
                                type="button"
                                className="scm-btn-primary scm-btn--sm"
                                disabled={acting}
                                onClick={() => awardQuote(row.supplier_quotation)}
                              >
                                Award PO
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </ScmModal>
    </div>
  );
}
