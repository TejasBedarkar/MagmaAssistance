import { useMemo, useState } from "react";
import { Building2, CheckCircle, GitBranch, Warehouse } from "lucide-react";
import toast from "react-hot-toast";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import useDebouncedValue from "../hooks/useDebouncedValue.js";
import useScmList from "../hooks/useScmList.js";
import { getWarehouse, listWarehouses } from "../api/warehouses.js";
import ScmPageHeader from "../components/ScmPageHeader.jsx";
import ScmListFilters from "../components/ScmListFilters.jsx";
import ScmDataTable from "../components/ScmDataTable.jsx";
import ScmKpiCard from "../components/ScmKpiCard.jsx";
import ScmPageKpiGrid from "../components/ScmPageKpiGrid.jsx";
import ScmPanel from "../components/ScmPanel.jsx";
import ScmQuickLinks from "../components/ScmQuickLinks.jsx";
import ScmModal from "../components/ScmModal.jsx";
import { ScmDetailField } from "../components/ScmDetailPanel.jsx";
import { countWhere, distinctCount } from "../utils/scmPageHelpers.js";

export default function WarehousesPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const { rows, loading, error, updated, reload } = useScmList(
    () => listWarehouses(),
    [],
  );

  const filtered = useMemo(() => {
    const q = (debouncedSearch || search).trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.name || "").toLowerCase().includes(q) ||
        (r.warehouse_name || "").toLowerCase().includes(q),
    );
  }, [rows, debouncedSearch, search]);

  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(filtered, 25);

  const kpis = useMemo(
    () => ({
      total: rows.length,
      active: countWhere(rows, (r) => !r.disabled),
      withParent: countWhere(rows, (r) => r.parent_warehouse),
      companies: distinctCount(rows, "company"),
    }),
    [rows],
  );

  const openRow = async (row) => {
    setSelected(row.name);
    setDetail(null);
    setLoadingDetail(true);
    try {
      setDetail(await getWarehouse(row.name));
    } catch {
      toast.error("Could not load warehouse.");
      setSelected(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const closeModal = () => {
    setDetail(null);
    setSelected(null);
    setLoadingDetail(false);
  };

  const columns = [
    { key: "name", header: "Code", className: "scm-table__cell--link" },
    { key: "warehouse_name", header: "Name", className: "scm-table__cell--strong" },
    { key: "company", header: "Company" },
    { key: "parent_warehouse", header: "Parent" },
    {
      key: "disabled",
      header: "Active",
      render: (r) => (r.disabled ? "No" : "Yes"),
    },
  ];

  return (
    <div className="scm-page scm-warehouses-page">
      <ScmPageHeader
        title="Warehouses"
        subtitle="RM, FG, reject, and scrap storage locations"
        updated={updated}
        loading={loading}
        actions={
          <>
            <ScmQuickLinks
              links={[
                { to: "/supply-chain/inventory", label: "Stock" },
                { to: "/supply-chain/plant", label: "Plant" },
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
        <ScmKpiCard label="Total warehouses" value={kpis.total} sub="Storage locations" icon={<Warehouse size={16} />} />
        <ScmKpiCard
          label="Active"
          value={kpis.active}
          sub="Enabled for transactions"
          tone="success"
          icon={<CheckCircle size={16} />}
        />
        <ScmKpiCard label="With parent" value={kpis.withParent} sub="Nested hierarchy" icon={<GitBranch size={16} />} />
        <ScmKpiCard label="Companies" value={kpis.companies} sub="Distinct legal entities" icon={<Building2 size={16} />} />
      </ScmPageKpiGrid>

      {error ? <div className="scm-error-banner">{error}</div> : null}

      <ScmPanel
        title="Warehouse directory"
        subtitle="Bins for stock, transfers, and GRN putaway"
      >
        <p className="scm-page-hint scm-page-hint--muted">
          Warehouses are maintained in ERPNext. Map them to plants for manufacturing capacity.
        </p>
      </ScmPanel>

      <ScmListFilters
        search={search}
        onSearchChange={(v) => { setSearch(v); resetPage(); }}
        searchPlaceholder="Search warehouse…"
      />

      <ScmDataTable
        columns={columns}
        rows={pageRows}
        loading={loading}
        emptyIcon={Warehouse}
        emptyTitle="No warehouses"
        emptyDescription="Set up warehouses in ERPNext for stock and GRN putaway."
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
        title={detail?.warehouse_name || selected || "Warehouse"}
        subtitle={detail?.name || selected || "Loading…"}
        onClose={closeModal}
        footer={
          <button type="button" className="scm-btn-ghost" onClick={closeModal}>
            Close
          </button>
        }
      >
        {loadingDetail ? (
          <p className="scm-modal-loading">Loading warehouse…</p>
        ) : detail ? (
          <div className="scm-detail-grid">
            <ScmDetailField label="Company" value={detail.company} />
            <ScmDetailField label="Parent" value={detail.parent_warehouse} />
            <ScmDetailField label="Disabled" value={detail.disabled ? "Yes" : "No"} />
          </div>
        ) : null}
      </ScmModal>
    </div>
  );
}
