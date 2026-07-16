import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Lock, Package, Warehouse, GitBranch } from "lucide-react";
import toast from "react-hot-toast";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import useDebouncedValue from "../hooks/useDebouncedValue.js";
import useScmList from "../hooks/useScmList.js";
import {
  getReservationSummary,
  listReservations,
  releaseReservation,
  reserveForMaterialRequest,
} from "../api/reservation.js";
import {
  getSalesOrderReservationPlanning,
  listSalesOrdersPendingReservation,
} from "../api/integration.js";
import { listWarehouses } from "../api/warehouses.js";
import ScmPageHeader from "../components/ScmPageHeader.jsx";
import ScmListFilters from "../components/ScmListFilters.jsx";
import ScmDataTable from "../components/ScmDataTable.jsx";
import ScmStatusBadge from "../components/ScmStatusBadge.jsx";
import ScmKpiCard from "../components/ScmKpiCard.jsx";
import ScmPageKpiGrid from "../components/ScmPageKpiGrid.jsx";
import ScmPanel from "../components/ScmPanel.jsx";
import ScmQuickLinks from "../components/ScmQuickLinks.jsx";
import ScmModal from "../components/ScmModal.jsx";
import { ScmDetailField } from "../components/ScmDetailPanel.jsx";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "Open", label: "Open" },
  { value: "Partially Used", label: "Partially used" },
  { value: "Released", label: "Released" },
];

const OPEN_STATUSES = new Set(["Open", "Partially Used"]);

function remainingQty(row) {
  const qty = Number(row?.qty || 0);
  const used = Number(row?.reserved_qty || 0);
  return Math.max(qty - used, 0);
}

function formatWhen(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

function sourceLink(row) {
  if (row.source_doctype === "Material Request" && row.source_name) {
    return `/supply-chain/material-requests?mr=${encodeURIComponent(row.source_name)}`;
  }
  if (row.source_doctype === "Sales Order" && row.source_name) {
    return `/sales/orders?open=${encodeURIComponent(row.source_name)}`;
  }
  return null;
}

export default function ReservationsPage() {
  const [searchParams] = useSearchParams();
  const mrFromUrl = searchParams.get("mr") || "";
  const soFromUrl = searchParams.get("so") || "";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [summaryRows, setSummaryRows] = useState([]);
  const [warehouseOptions, setWarehouseOptions] = useState([{ value: "", label: "All warehouses" }]);
  const [selected, setSelected] = useState(null);
  const [acting, setActing] = useState(false);
  const [mrInput, setMrInput] = useState(mrFromUrl);
  const [whInput, setWhInput] = useState("");
  const [pendingSoRows, setPendingSoRows] = useState([]);
  const [soPlanning, setSoPlanning] = useState(null);
  const [soPlanningLoading, setSoPlanningLoading] = useState(false);

  const { rows, loading, error, updated, reload } = useScmList(
    async () => {
      const [reservations, summaryRes, warehouses] = await Promise.all([
        listReservations({
          item_code: debouncedSearch || undefined,
          warehouse: warehouseFilter || undefined,
          status: statusFilter || undefined,
          source_doctype: soFromUrl ? "Sales Order" : undefined,
          source_name: soFromUrl || undefined,
          limit: 200,
        }),
        getReservationSummary({
          item_code: debouncedSearch || undefined,
          warehouse: warehouseFilter || undefined,
        }).catch(() => ({ summary: [] })),
        listWarehouses().catch(() => []),
      ]);

      const summary = Array.isArray(summaryRes?.summary)
        ? summaryRes.summary
        : Array.isArray(summaryRes)
          ? summaryRes
          : [];
      setSummaryRows(summary);

      if (warehouses.length) {
        setWarehouseOptions([
          { value: "", label: "All warehouses" },
          ...warehouses
            .filter((w) => !w.disabled)
            .map((w) => ({
              value: w.name,
              label: w.warehouse_name || w.name,
            })),
        ]);
      }

      return reservations;
    },
    [debouncedSearch, statusFilter, warehouseFilter, soFromUrl],
  );

  useEffect(() => {
    if (soFromUrl) {
      setPendingSoRows([]);
      return undefined;
    }
    let cancelled = false;
    listSalesOrdersPendingReservation(undefined, 25)
      .then((data) => {
        if (!cancelled) setPendingSoRows(data?.rows || []);
      })
      .catch(() => {
        if (!cancelled) setPendingSoRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [soFromUrl, updated]);

  useEffect(() => {
    if (!soFromUrl) {
      setSoPlanning(null);
      setSoPlanningLoading(false);
      return undefined;
    }
    let cancelled = false;
    setSoPlanningLoading(true);
    setSoPlanning(null);
    getSalesOrderReservationPlanning(soFromUrl)
      .then((data) => {
        if (!cancelled) setSoPlanning(data);
      })
      .catch(() => {
        if (!cancelled) setSoPlanning(null);
      })
      .finally(() => {
        if (!cancelled) setSoPlanningLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [soFromUrl, updated]);

  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(rows, 25);

  const kpis = useMemo(() => {
    const openRows = rows.filter((r) => OPEN_STATUSES.has(r.status));
    const lockedFromRows = openRows.reduce((sum, r) => sum + remainingQty(r), 0);
    const lockedFromSummary = summaryRows.reduce(
      (sum, r) => sum + Number(r.locked_qty || 0),
      0,
    );
    return {
      openCount: openRows.length,
      lockedQty: lockedFromSummary || lockedFromRows,
      itemCount: new Set(openRows.map((r) => r.item_code)).size,
      warehouseCount: new Set(openRows.map((r) => r.warehouse).filter(Boolean)).size,
    };
  }, [rows, summaryRows]);

  const topLocked = useMemo(
    () =>
      [...summaryRows]
        .sort((a, b) => Number(b.locked_qty || 0) - Number(a.locked_qty || 0))
        .slice(0, 6),
    [summaryRows],
  );

  const openRow = useCallback((row) => setSelected(row), []);

  const closeModal = () => setSelected(null);

  const releaseOne = async (row) => {
    setActing(true);
    try {
      await releaseReservation({ reservation_id: row.name || row.reservation_id });
      toast.success("Reservation released — stock unlocked.");
      setSelected(null);
      reload();
    } catch (err) {
      toast.error(err?.message || "Release failed.");
    } finally {
      setActing(false);
    }
  };

  const reserveMr = async () => {
    if (!mrInput.trim()) {
      toast.error("Enter a material request ID.");
      return;
    }
    setActing(true);
    try {
      const res = await reserveForMaterialRequest(
        mrInput.trim(),
        whInput.trim() || undefined,
      );
      toast.success(`Reserved ${(res.reservations || []).length} line(s) for ${mrInput.trim()}.`);
      reload();
    } catch (err) {
      toast.error(err?.message || "Reservation failed.");
    } finally {
      setActing(false);
    }
  };

  const columns = [
    { key: "name", header: "Reservation", className: "scm-table__cell--link" },
    { key: "item_code", header: "Item", className: "scm-table__cell--strong" },
    {
      key: "remaining",
      header: "Locked",
      render: (r) => `${remainingQty(r)} / ${r.qty ?? 0}`,
    },
    { key: "warehouse", header: "Warehouse" },
    { key: "plant", header: "Plant", render: (r) => r.plant || "—" },
    {
      key: "status",
      header: "Status",
      render: (r) => <ScmStatusBadge status={r.status || "Open"} />,
    },
    {
      key: "source_name",
      header: "Source",
      render: (r) => {
        const href = sourceLink(r);
        const label = r.source_name || r.source_doctype || "—";
        return href ? (
          <Link to={href} className="scm-link-btn--sm" onClick={(e) => e.stopPropagation()}>
            {label}
          </Link>
        ) : (
          label
        );
      },
    },
    {
      key: "reserved_on",
      header: "Reserved",
      render: (r) => formatWhen(r.reserved_on),
    },
  ];

  const canRelease = selected && OPEN_STATUSES.has(selected.status);

  return (
    <div className="scm-page scm-reservations-page">
      <ScmPageHeader
        title="Material reservations"
        subtitle="Lock stock for MRs and MRP — inventory held until released or consumed"
        updated={updated}
        loading={loading}
        actions={
          <>
            <ScmQuickLinks
              links={[
                { to: "/supply-chain/mrp", label: "MRP planning" },
                { to: "/supply-chain/material-requests", label: "Material requests" },
                { to: "/supply-chain/inventory", label: "Stock" },
              ]}
            />
            <button type="button" className="scm-btn-ghost" onClick={reload} disabled={loading}>
              Refresh
            </button>
          </>
        }
      />

      {soFromUrl ? (
        <p className="scm-page-hint scm-reservations-hint">
          Filtered to Sales Order <strong>{soFromUrl}</strong>.{" "}
          <Link to={`/sales/orders?open=${encodeURIComponent(soFromUrl)}`} className="scm-link-btn--sm">
            Open in Sales
          </Link>
        </p>
      ) : null}

      {soFromUrl && soPlanningLoading ? (
        <p className="scm-page-hint scm-reservations-hint">Loading Sales Order reservation planning…</p>
      ) : null}

      {soFromUrl && soPlanning ? (
        <ScmPanel
          title="Sales order — reservation planning (Phase D)"
          subtitle="Live status from Sales; SCM Material Reservation rows appear when stock is blocked"
        >
          <div className="scm-reservations-so-plan">
            <p className="scm-reservations-so-plan__meta">
              <strong>{soPlanning.sales_order}</strong>
              {soPlanning.customer_name ? ` · ${soPlanning.customer_name}` : ""}
              {" · stage "}
              <ScmStatusBadge status={soPlanning.reservation_stage || "pending"} />
              {" · blocked "}
              {Number(soPlanning.blocked_qty_total || 0).toFixed(0)}
              {" / "}
              {Number(soPlanning.stock_line_count || 0).toFixed(0)} lines
            </p>
            {(soPlanning.lines || []).length ? (
              <table className="scm-table scm-reservations-so-plan__table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Warehouse</th>
                    <th>Ordered</th>
                    <th>SCM locked</th>
                    <th>Available</th>
                  </tr>
                </thead>
                <tbody>
                  {(soPlanning.lines || []).map((line) => (
                    <tr key={`${line.item_code}-${line.warehouse}`}>
                      <td>{line.item_code}</td>
                      <td>{line.warehouse || "—"}</td>
                      <td>{Number(line.ordered_qty || 0).toFixed(0)}</td>
                      <td>{Number(line.scm_locked_qty || 0).toFixed(0)}</td>
                      <td>{Number(line.available_stock || 0).toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="scm-page-hint">No stock lines on this Sales Order.</p>
            )}
            {!rows.length ? (
              <p className="scm-page-hint">
                No SCM reservation rows yet — stock block is automatic after Sales Order submit when warehouse
                available qty is sufficient (or after manufacturing completes for make-to-order).
              </p>
            ) : null}
          </div>
        </ScmPanel>
      ) : null}

      {!soFromUrl && pendingSoRows.length ? (
        <ScmPanel
          title="Sales orders — inventory reservation (Phase D)"
          subtitle="Submitted orders awaiting full SCM stock block"
        >
          <ul className="scm-sales-planning-list">
            {pendingSoRows.map((row) => (
              <li key={row.sales_order}>
                <Link
                  to={row.scm_reservations_url || `/supply-chain/reservations?so=${encodeURIComponent(row.sales_order)}`}
                  className="scm-link-btn--sm"
                >
                  {row.sales_order}
                </Link>
                {row.customer_name ? ` · ${row.customer_name}` : ""}
                <span>
                  {" · blocked "}
                  {Number(row.blocked_qty_total || 0).toFixed(0)}
                  /{Number(row.stock_line_count || 0)} lines
                </span>
                <Link
                  to={row.sales_portal_url || `/sales/orders?open=${encodeURIComponent(row.sales_order)}`}
                  className="scm-link-btn--sm"
                >
                  Open in Sales
                </Link>
              </li>
            ))}
          </ul>
        </ScmPanel>
      ) : null}

      <ScmPageKpiGrid>
        <ScmKpiCard
          label="Open reservations"
          value={kpis.openCount}
          sub="Active locks on stock"
          tone="warn"
          icon={<Lock size={16} />}
        />
        <ScmKpiCard
          label="Locked quantity"
          value={kpis.lockedQty.toLocaleString("en-IN")}
          sub="Units still reserved"
          tone="danger"
          icon={<Package size={16} />}
        />
        <ScmKpiCard
          label="Items affected"
          value={kpis.itemCount}
          sub="Distinct item codes"
          icon={<GitBranch size={16} />}
        />
        <ScmKpiCard
          label="Warehouses"
          value={kpis.warehouseCount}
          sub="With active locks"
          icon={<Warehouse size={16} />}
        />
      </ScmPageKpiGrid>

      <div className="scm-page-two-col">
        <ScmPanel
          title="Reserve from material request"
          subtitle="Pulls open MR lines and locks available bin qty (PDF §10 MRP)"
          className="scm-reservations-action-panel"
        >
          <div className="scm-page-action-form">
            <label className="scm-form-field scm-form-field--grow">
              <span className="scm-form-label">Material request</span>
              <input
                className="scm-input"
                value={mrInput}
                onChange={(e) => setMrInput(e.target.value)}
                placeholder="MAT-MR-2026-00001"
              />
            </label>
            <label className="scm-form-field">
              <span className="scm-form-label">Warehouse (optional)</span>
              <select
                className="scm-input"
                value={whInput}
                onChange={(e) => setWhInput(e.target.value)}
              >
                <option value="">Default warehouse</option>
                {warehouseOptions
                  .filter((o) => o.value)
                  .map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              className="scm-btn-primary scm-reservations-action-btn"
              disabled={acting || !mrInput.trim()}
              onClick={reserveMr}
            >
              {acting ? "Reserving…" : "Reserve stock"}
            </button>
          </div>
          {mrFromUrl ? (
            <p className="scm-page-hint">
              Pre-filled from URL.{" "}
              <Link to="/supply-chain/material-requests" className="scm-link-btn--sm">
                Browse MRs
              </Link>
            </p>
          ) : null}
        </ScmPanel>

        {topLocked.length > 0 ? (
          <ScmPanel
            title="Locked stock summary"
            subtitle="By item and warehouse"
            badge={
              <span className="scm-panel-badge">{topLocked.length} lines</span>
            }
            className="scm-reservations-summary-panel"
          >
            <ul className="scm-reservations-summary-list">
              {topLocked.map((row) => (
                <li key={`${row.item_code}-${row.warehouse}`} className="scm-reservations-summary-item">
                  <div>
                    <p className="scm-reservations-summary-item__code">{row.item_code}</p>
                    <p className="scm-reservations-summary-item__wh">{row.warehouse || "—"}</p>
                  </div>
                  <span className="scm-reservations-summary-item__qty">
                    {Number(row.locked_qty || 0).toLocaleString("en-IN")} locked
                  </span>
                </li>
              ))}
            </ul>
          </ScmPanel>
        ) : null}
      </div>

      <ScmListFilters
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          resetPage();
        }}
        searchPlaceholder="Filter by item code…"
        selectLabel="Status"
        selectValue={statusFilter}
        selectOptions={STATUS_OPTIONS}
        onSelectChange={(v) => {
          setStatusFilter(v);
          resetPage();
        }}
      >
        <select
          className="scm-input scm-toolbar__select"
          value={warehouseFilter}
          onChange={(e) => {
            setWarehouseFilter(e.target.value);
            resetPage();
          }}
          aria-label="Warehouse"
        >
          {warehouseOptions.map((o) => (
            <option key={o.value || "all"} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </ScmListFilters>

      {error ? <div className="scm-error-banner">{error}</div> : null}

      <ScmDataTable
        columns={columns}
        rows={pageRows}
        loading={loading}
        emptyIcon={Lock}
        emptyTitle="No reservations"
        emptyDescription="Reserve stock from a material request or run MRP to generate demand."
        getRowKey={(r) => r.name || r.reservation_id}
        activeKey={selected?.name || selected?.reservation_id}
        onRowClick={openRow}
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={25}
        onPageChange={setPage}
      />

      <ScmModal
        open={Boolean(selected)}
        title={selected?.name || "Reservation"}
        subtitle={selected?.item_code}
        onClose={closeModal}
        footer={
          <>
            <button type="button" className="scm-btn-ghost" onClick={closeModal}>
              Close
            </button>
            {canRelease ? (
              <button
                type="button"
                className="scm-btn-primary"
                disabled={acting}
                onClick={() => releaseOne(selected)}
              >
                {acting ? "Releasing…" : "Release lock"}
              </button>
            ) : null}
          </>
        }
      >
        {selected ? (
          <>
            <div className="scm-detail-grid">
              <ScmDetailField label="Status" value={selected.status} />
              <ScmDetailField label="Locked qty" value={`${remainingQty(selected)} / ${selected.qty}`} />
              <ScmDetailField label="Warehouse" value={selected.warehouse} />
              <ScmDetailField label="Plant" value={selected.plant || "—"} />
              <ScmDetailField label="Source type" value={selected.source_doctype || "—"} />
              <ScmDetailField label="Source document" value={selected.source_name || "—"} />
              <ScmDetailField label="Reserved by" value={selected.reserved_by || "—"} />
              <ScmDetailField label="Reserved on" value={formatWhen(selected.reserved_on)} />
            </div>
            {sourceLink(selected) ? (
              <p className="scm-page-hint">
                <Link to={sourceLink(selected)} className="scm-link-btn--sm">
                  Open source {selected.source_doctype}
                </Link>
              </p>
            ) : null}
            {!canRelease ? (
              <p className="scm-page-hint scm-page-hint--muted">
                Only open or partially used reservations can be released.
              </p>
            ) : null}
          </>
        ) : null}
      </ScmModal>
    </div>
  );
}
