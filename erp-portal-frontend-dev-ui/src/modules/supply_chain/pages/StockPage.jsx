import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Boxes, Lock, Package } from "lucide-react";
import toast from "react-hot-toast";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import useDebouncedValue from "../hooks/useDebouncedValue.js";
import useScmList from "../hooks/useScmList.js";
import { getItemStock, listStock } from "../api/stock.js";
import { listWarehouses } from "../api/warehouses.js";
import ScmPageHeader from "../components/ScmPageHeader.jsx";
import ScmListFilters from "../components/ScmListFilters.jsx";
import ScmDataTable from "../components/ScmDataTable.jsx";
import ScmKpiCard from "../components/ScmKpiCard.jsx";
import ScmPageKpiGrid from "../components/ScmPageKpiGrid.jsx";
import ScmPanel from "../components/ScmPanel.jsx";
import ScmQuickLinks from "../components/ScmQuickLinks.jsx";
import ScmModal from "../components/ScmModal.jsx";
import { ScmDetailField } from "../components/ScmDetailPanel.jsx";
import { countWhere, sumField } from "../utils/scmPageHelpers.js";

function availableQty(row) {
  return Number(row.available_qty ?? row.actual_qty ?? 0);
}

export default function StockPage() {
  const [search, setSearch] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [warehouses, setWarehouses] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [checkItem, setCheckItem] = useState("");
  const [checkWh, setCheckWh] = useState("");
  const [checkResult, setCheckResult] = useState(null);
  const [checking, setChecking] = useState(false);

  const { rows, loading, error, updated, reload } = useScmList(async () => {
    const [stockRows, whRows] = await Promise.all([
      listStock({ warehouse: warehouse || undefined, limit: 500 }),
      listWarehouses(),
    ]);
    setWarehouses(whRows);
    return stockRows;
  }, [warehouse]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.item_code || "").toLowerCase().includes(q) ||
        (r.item_name || "").toLowerCase().includes(q) ||
        (r.warehouse || "").toLowerCase().includes(q),
    );
  }, [rows, debouncedSearch]);

  const kpis = useMemo(
    () => ({
      rowCount: filtered.length,
      onHand: sumField(filtered, "actual_qty"),
      scmLocked: sumField(filtered, "scm_locked_qty"),
      zeroAvailable: countWhere(filtered, (r) => availableQty(r) <= 0),
    }),
    [filtered],
  );

  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(filtered, 25);

  const closeModal = useCallback(() => {
    setDetail(null);
    setSelected(null);
    setLoadingDetail(false);
  }, []);

  const openRow = useCallback(async (row) => {
    const key = `${row.item_code}-${row.warehouse}`;
    setSelected(key);
    setDetail(null);
    setLoadingDetail(true);
    try {
      setDetail(await getItemStock(row.item_code, { warehouse: row.warehouse }));
    } catch {
      toast.error("Could not load stock detail.");
      setSelected(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const checkAvailability = async () => {
    const code = checkItem.trim();
    if (!code) {
      toast.error("Enter an item code.");
      return;
    }
    setChecking(true);
    setCheckResult(null);
    try {
      const result = await getItemStock(code, { warehouse: checkWh || undefined });
      setCheckResult(result);
    } catch (err) {
      toast.error(err?.message || "Could not check availability.");
    } finally {
      setChecking(false);
    }
  };

  const whOptions = [
    { value: "", label: "All warehouses" },
    ...warehouses.map((w) => ({ value: w.name, label: w.warehouse_name || w.name })),
  ];

  const columns = [
    { key: "item_code", header: "Item", className: "scm-table__cell--link" },
    { key: "item_name", header: "Name", className: "scm-table__cell--strong" },
    { key: "warehouse", header: "Warehouse" },
    {
      key: "actual_qty",
      header: "On hand",
      render: (r) => Number(r.actual_qty || 0).toLocaleString("en-IN"),
    },
    {
      key: "scm_locked_qty",
      header: "SCM locked",
      render: (r) => Number(r.scm_locked_qty || 0).toLocaleString("en-IN"),
    },
    {
      key: "available_qty",
      header: "Available",
      render: (r) => availableQty(r).toLocaleString("en-IN"),
    },
  ];

  const whRows = detail?.by_warehouse || [];

  return (
    <div className="scm-page scm-stock-page">
      <ScmPageHeader
        title="Stock"
        subtitle="Live Bin quantities — same source Sales and Manufacturing use"
        updated={updated}
        loading={loading}
        actions={
          <>
            <ScmQuickLinks
              links={[
                { to: "/supply-chain/material-requests", label: "Material requests" },
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
          label="Stock rows"
          value={kpis.rowCount}
          sub="Item × warehouse lines"
          icon={<Boxes size={16} />}
        />
        <ScmKpiCard
          label="On hand"
          value={kpis.onHand.toLocaleString("en-IN")}
          sub="Total physical qty"
          tone="default"
          icon={<Package size={16} />}
        />
        <ScmKpiCard
          label="SCM locked"
          value={kpis.scmLocked.toLocaleString("en-IN")}
          sub="Reserved for MR / MRP"
          tone="warn"
          icon={<Lock size={16} />}
        />
        <ScmKpiCard
          label="Zero available"
          value={kpis.zeroAvailable}
          sub="Rows with no free qty"
          tone={kpis.zeroAvailable > 0 ? "danger" : "default"}
          icon={<AlertTriangle size={16} />}
        />
      </ScmPageKpiGrid>

      <ScmPanel
        title="Check availability"
        subtitle="Live bin qty for an item across warehouses"
        className="scm-stock-action-panel"
      >
        <div className="scm-page-action-form">
          <label className="scm-form-field scm-form-field--grow">
            <span className="scm-form-label">Item code</span>
            <input
              className="scm-input"
              value={checkItem}
              onChange={(e) => setCheckItem(e.target.value)}
              placeholder="SCM-DEMO-RM-001"
            />
          </label>
          <label className="scm-form-field">
            <span className="scm-form-label">Warehouse (optional)</span>
            <select
              className="scm-input"
              value={checkWh}
              onChange={(e) => setCheckWh(e.target.value)}
            >
              <option value="">All warehouses</option>
              {warehouses.map((w) => (
                <option key={w.name} value={w.name}>
                  {w.warehouse_name || w.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="scm-btn-primary scm-reservations-action-btn"
            disabled={checking || !checkItem.trim()}
            onClick={checkAvailability}
          >
            {checking ? "Checking…" : "Check qty"}
          </button>
        </div>
        {checkResult ? (
          <p className="scm-page-hint">
            <strong>{checkResult.item_code}</strong> — total on hand{" "}
            {Number(checkResult.total_qty || 0).toLocaleString("en-IN")}
            {(checkResult.by_warehouse || []).length > 0
              ? ` across ${checkResult.by_warehouse.length} warehouse(s). Click a table row for full breakdown.`
              : "."}
          </p>
        ) : (
          <p className="scm-page-hint scm-page-hint--muted">
            Uses the same Bin source as Sales and Manufacturing stock checks.
          </p>
        )}
      </ScmPanel>

      <ScmListFilters
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          resetPage();
        }}
        searchPlaceholder="Search item or warehouse…"
        selectLabel="Warehouse"
        selectValue={warehouse}
        selectOptions={whOptions}
        onSelectChange={(v) => {
          setWarehouse(v);
          resetPage();
        }}
      />

      {error ? <div className="scm-error-banner">{error}</div> : null}

      <ScmDataTable
        columns={columns}
        rows={pageRows}
        loading={loading}
        emptyIcon={Boxes}
        emptyTitle="No stock rows"
        emptyDescription="Stock appears after items are received via GRN."
        getRowKey={(r) => `${r.item_code}-${r.warehouse}`}
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
        title={detail?.item_code || selected?.split("-")?.[0] || "Stock"}
        subtitle={detail ? `Total on hand: ${Number(detail.total_qty || 0).toLocaleString("en-IN")}` : "Loading…"}
        wide
        onClose={closeModal}
        footer={
          <button type="button" className="scm-btn-ghost" onClick={closeModal}>
            Close
          </button>
        }
      >
        {loadingDetail ? (
          <p className="scm-modal-loading">Loading stock detail…</p>
        ) : detail ? (
          <>
            <div className="scm-detail-grid">
              <ScmDetailField label="Item" value={detail.item_code} />
              <ScmDetailField label="Total on hand" value={Number(detail.total_qty || 0).toLocaleString("en-IN")} />
            </div>
            <div className="scm-table-scroll">
              <table className="scm-table">
                <thead>
                  <tr className="scm-table__row">
                    {["Warehouse", "On hand", "ERP reserved", "SCM locked", "Available"].map((h) => (
                      <th key={h} className="scm-table__head">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {whRows.map((line) => (
                    <tr key={line.warehouse} className="scm-table__row">
                      <td className="scm-table__cell">{line.warehouse}</td>
                      <td className="scm-table__cell">{Number(line.actual_qty || 0).toLocaleString("en-IN")}</td>
                      <td className="scm-table__cell">{Number(line.reserved_qty || 0).toLocaleString("en-IN")}</td>
                      <td className="scm-table__cell">{Number(line.scm_locked_qty || 0).toLocaleString("en-IN")}</td>
                      <td className="scm-table__cell scm-table__cell--strong">
                        {Number(line.available_qty ?? 0).toLocaleString("en-IN")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="scm-modal-loading">Could not load stock.</p>
        )}
      </ScmModal>
    </div>
  );
}
