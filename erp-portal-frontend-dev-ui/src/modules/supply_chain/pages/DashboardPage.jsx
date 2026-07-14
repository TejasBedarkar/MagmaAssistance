import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ClipboardList,
  Inbox,
  Package,
  IndianRupee,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ScmFilterBar from "../components/ScmFilterBar.jsx";
import ScmKpiCard from "../components/ScmKpiCard.jsx";
import ScmPanel from "../components/ScmPanel.jsx";
import ScmStatusBadge from "../components/ScmStatusBadge.jsx";
import useSupplyChainDashboard, { buildDefaultFilters } from "../hooks/useSupplyChainDashboard.js";
import { listSalesQuotationsAwaitingCapacity, listSalesOrdersPendingReservation, listSalesOrdersReadyForDispatch, listSalesOrdersAwaitingFgReceipt } from "../api/integration.js";
import { listPlants } from "../api/plant.js";

const fmtInr = (n) =>
  `₹ ${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const hint = payload[0]?.payload?.hint;
  return (
    <div className="scm-chart-tooltip">
      <p className="scm-chart-tooltip__label">{label}</p>
      <p className="scm-chart-tooltip__value">{payload[0].value}</p>
      {hint ? <p className="scm-chart-tooltip__hint">{hint}</p> : null}
    </div>
  );
}

function StockValueTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="scm-chart-tooltip">
      <p className="scm-chart-tooltip__label">{label}</p>
      <p className="scm-chart-tooltip__value">{fmtInr(payload[0].value)}</p>
    </div>
  );
}

export default function DashboardPage() {
  const { data, loading, error, updated, reload, filters, filterOptions, patchFilters, clearFilters } =
    useSupplyChainDashboard();

  const kpis = data?.kpis || {};
  const criticalCount = useMemo(
    () => (data?.low_stock_alerts || []).filter((r) => r.trigger === "critical").length,
    [data],
  );

  const hasActiveFilters = useMemo(() => {
    const defaults = buildDefaultFilters();
    return Boolean(
      filters.warehouse ||
        filters.supplier ||
        filters.item_type ||
        filters.date_from !== defaults.date_from ||
        filters.date_to !== defaults.date_to,
    );
  }, [filters]);

  const [capacityPlanningRows, setCapacityPlanningRows] = useState([]);
  const [hasScmPlants, setHasScmPlants] = useState(true);
  const [soReservationRows, setSoReservationRows] = useState([]);
  const [soDispatchReadyRows, setSoDispatchReadyRows] = useState([]);
  const [soAwaitingFgRows, setSoAwaitingFgRows] = useState([]);
  useEffect(() => {
    listSalesQuotationsAwaitingCapacity(undefined, 6)
      .then((data) => setCapacityPlanningRows(data?.rows || []))
      .catch(() => setCapacityPlanningRows([]));
    listPlants({ limit: 5 })
      .then((rows) => setHasScmPlants((rows || []).length > 0))
      .catch(() => setHasScmPlants(true));
    listSalesOrdersPendingReservation(undefined, 6)
      .then((data) => setSoReservationRows(data?.rows || []))
      .catch(() => setSoReservationRows([]));
    listSalesOrdersReadyForDispatch(undefined, 6)
      .then((data) => setSoDispatchReadyRows(data?.rows || []))
      .catch(() => setSoDispatchReadyRows([]));
    listSalesOrdersAwaitingFgReceipt(undefined, 6)
      .then((data) => setSoAwaitingFgRows(data?.rows || []))
      .catch(() => setSoAwaitingFgRows([]));
  }, [updated]);

  if (error && !data) {
    return (
      <div className="scm-dash-error">
        <p className="scm-dash-error__message">{error}</p>
        <button type="button" onClick={reload} className="scm-btn-primary">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="scm-dash-page">
      <header className="scm-dash-header">
        <div>
          <p className="scm-dash-eyebrow">Supply Chain</p>
          <h1 className="scm-dash-title">Supply Chain Control Tower</h1>
          <p className="scm-dash-desc">
            Low stock, procurement pipeline, inbound receipts, and material availability
          </p>
          {updated ? (
            <p className="scm-dash-updated">
              Updated {updated}
              {loading ? " · Refreshing…" : ""}
            </p>
          ) : null}
        </div>
        <div className="scm-dash-header__actions">
          <button
            type="button"
            onClick={() => reload("refresh-button")}
            disabled={loading}
            className="scm-btn-ghost"
          >
            Refresh
          </button>
          <Link to="/supply-chain/material-requests" className="scm-btn-primary">
            Open procurement
          </Link>
        </div>
      </header>

      <ScmFilterBar
        filters={filters}
        options={filterOptions}
        onChange={patchFilters}
        onClear={clearFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {criticalCount > 0 ? (
        <div className="scm-dash-alert" role="alert">
          <p className="scm-dash-alert__text">
            <strong>
              {criticalCount} critical stock alert{criticalCount === 1 ? "" : "s"}
            </strong>
            <span className="scm-dash-alert__muted">
              {" "}
              — Items below safety stock need procurement or transfer.
            </span>
          </p>
          <Link to="/supply-chain/inventory" className="scm-dash-alert__link">
            View stock
          </Link>
        </div>
      ) : null}

      <div className="scm-dash-kpi-grid">
        <ScmKpiCard
          label="Items below reorder"
          value={kpis.items_below_reorder ?? kpis.low_stock_count ?? 0}
          sub="Below reorder / safety"
          tone="danger"
          icon={<AlertTriangle size={16} />}
        />
        <ScmKpiCard
          label="Open material requests"
          value={kpis.open_material_requests ?? 0}
          sub="Pending, Partially Ordered, Partially Received, Submitted"
          tone="warn"
          icon={<ClipboardList size={16} />}
          hint="Submitted MRs still in the procurement queue"
        />
        <ScmKpiCard
          label="Pending purchase orders"
          value={kpis.pending_purchase_orders ?? kpis.open_purchase_orders ?? 0}
          sub="Submitted, not closed"
          tone="warn"
          icon={<Package size={16} />}
          hint="Same count as Procurement Pipeline PO issued bar"
        />
        <ScmKpiCard
          label="Pending GRNs (to inspect)"
          value={kpis.pending_grns_to_inspect ?? 0}
          sub="Awaiting receipt + pending inspection"
          tone="warn"
          icon={<Inbox size={16} />}
          hint="Combined: open POs awaiting GRN receipt plus GRNs in QC queue"
        />
        <ScmKpiCard
          label="Total stock value"
          value={fmtInr(kpis.total_stock_value)}
          sub={`Reserved ${kpis.locked_reservations_kg ?? 0} KG`}
          icon={<IndianRupee size={16} />}
        />
      </div>

      {!hasScmPlants ? (
        <div className="scm-dash-alert" role="alert">
          <p className="scm-dash-alert__text">
            <strong>No SCM plants yet.</strong>
            <span className="scm-dash-alert__muted">
              {" "}
              Capacity planning needs Plant Master with monthly capacity before SCM can verify quotations.
            </span>
          </p>
          <Link to="/supply-chain/plant" className="scm-dash-alert__link">
            Create plant
          </Link>
        </div>
      ) : null}

      {capacityPlanningRows.length ? (
        <ScmPanel
          title="Sales quotations — capacity planning"
          subtitle="Materials ready; awaiting Production Head capacity commitment in Sales"
          action={
            <Link to="/supply-chain/capacity-planning" className="scm-btn-ghost scm-btn-ghost--sm">
              View all
            </Link>
          }
        >
          <ul className="scm-sales-planning-list">
            {capacityPlanningRows.map((row) => (
              <li key={row.quotation}>
                <Link
                  to={row.sales_portal_url || `/sales/quotations?q=${encodeURIComponent(row.quotation)}`}
                  className="scm-link-btn--sm"
                >
                  {row.quotation}
                </Link>
                {row.party_name ? ` · ${row.party_name}` : ""}
                {row.plant_capacity?.verified_via_scm ? (
                  <span>
                    {" · SCM plant "}
                    {row.plant_capacity.plant_name || row.plant_capacity.plant_code}
                    {": "}
                    {Number(row.plant_capacity.available_capacity || 0).toFixed(0)}
                    /{Number(row.plant_capacity.required_qty || 0).toFixed(0)} avail
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </ScmPanel>
      ) : (
        <ScmPanel
          title="Sales quotations — capacity planning"
          subtitle="No quotations awaiting Production Head commit"
          action={
            <Link to="/supply-chain/capacity-planning" className="scm-btn-ghost scm-btn-ghost--sm">
              Open capacity planning
            </Link>
          }
        >
          <p className="scm-page-hint">
            When Sales quotations reach <strong>Awaiting Production</strong> with materials ready,
            they appear here and on the{" "}
            <Link to="/supply-chain/capacity-planning">capacity planning</Link> page.
            {!hasScmPlants ? (
              <>
                {" "}
                First create a plant in <Link to="/supply-chain/plant">Plant Master</Link>.
              </>
            ) : null}
          </p>
        </ScmPanel>
      )}

      {soReservationRows.length ? (
        <ScmPanel
          title="Sales orders — inventory reservation (Phase D)"
          subtitle="Submitted orders awaiting full SCM stock block"
        >
          <ul className="scm-sales-planning-list">
            {soReservationRows.map((row) => (
              <li key={row.sales_order}>
                <Link
                  to={row.sales_portal_url || `/sales/orders?open=${encodeURIComponent(row.sales_order)}`}
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
                  to={row.scm_reservations_url || `/supply-chain/reservations?so=${encodeURIComponent(row.sales_order)}`}
                  className="scm-link-btn--sm"
                >
                  SCM reservations
                </Link>
              </li>
            ))}
          </ul>
        </ScmPanel>
      ) : null}

      {soDispatchReadyRows.length ? (
        <ScmPanel
          title="Sales orders — ready for dispatch (Phase E)"
          subtitle="Stock reserved and inventory ready — create Delivery Note from Sales"
        >
          <ul className="scm-sales-planning-list">
            {soDispatchReadyRows.map((row) => (
              <li key={row.sales_order}>
                <Link
                  to={row.sales_portal_url || `/sales/orders?open=${encodeURIComponent(row.sales_order)}`}
                  className="scm-link-btn--sm"
                >
                  {row.sales_order}
                </Link>
                {row.customer_name ? ` · ${row.customer_name}` : ""}
                <span> · Delivery ready</span>
              </li>
            ))}
          </ul>
        </ScmPanel>
      ) : null}

      {soAwaitingFgRows.length ? (
        <ScmPanel
          title="Sales orders — awaiting FG / inventory (Phase E)"
          subtitle="Reserved orders waiting on manufacturing completion or SCM stock receipt"
        >
          <ul className="scm-sales-planning-list">
            {soAwaitingFgRows.map((row) => (
              <li key={row.sales_order}>
                <Link
                  to={row.sales_portal_url || `/sales/orders?open=${encodeURIComponent(row.sales_order)}`}
                  className="scm-link-btn--sm"
                >
                  {row.sales_order}
                </Link>
                {row.customer_name ? ` · ${row.customer_name}` : ""}
                <span>
                  {" · "}
                  {row.finished_goods_ready ? "FG ready" : "Awaiting FG"}
                  {row.fg_stock_received ? " · stock OK" : " · awaiting stock"}
                </span>
              </li>
            ))}
          </ul>
        </ScmPanel>
      ) : null}

      <div className="scm-dash-row--2">
        <ScmPanel
          title="Low stock alerts"
          subtitle="Reorder triggers — notify stores, production, and purchase team"
          badge={
            <span className="scm-panel-badge">
              {(data?.low_stock_alerts || []).length} active
            </span>
          }
        >
          <div className="scm-table-scroll scm-dash-table-scroll scm-dash-table-scroll--tall">
            <table className="scm-table scm-table--wide">
              <thead>
                <tr className="scm-table__row">
                  {["Code", "Material", "Plant", "WH", "On hand", "Reorder", "Flag"].map((h) => (
                    <th key={h} className="scm-table__head">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.low_stock_alerts || []).map((row) => (
                  <tr key={row.id} className="scm-table__row scm-table__row--hover">
                    <td className="scm-table__cell">{row.item_code}</td>
                    <td className="scm-table__cell scm-table__cell--strong">{row.item_name}</td>
                    <td className="scm-table__cell">{row.plant}</td>
                    <td className="scm-table__cell">{row.warehouse}</td>
                    <td className="scm-table__cell">
                      {row.on_hand} {row.uom}
                    </td>
                    <td className="scm-table__cell">
                      {row.reorder_level} {row.uom}
                    </td>
                    <td className="scm-table__cell">
                      <ScmStatusBadge status={row.trigger} tone={row.trigger} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ScmPanel>

        <ScmPanel title="Procurement pipeline" subtitle="MR → PO → GRN → Inspection">
          <div className="scm-chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data?.procurement_pipeline || []}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis
                  dataKey="stage"
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ScmPanel>
      </div>

      <div className="scm-dash-row--3">
        <ScmPanel
          title="Recent material requests"
          subtitle="Latest MRs from Sales, Manufacturing, and manual entry"
          className="scm-dash-col--1"
        >
          <div className="scm-table-scroll scm-dash-table-scroll scm-dash-table-scroll--sm">
            <table className="scm-table">
              <thead>
                <tr className="scm-table__row">
                  {["MR #", "Date", "Source", "Qty", "Status"].map((h) => (
                    <th key={h} className="scm-table__head">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.recent_material_requests || []).map((row) => (
                  <tr key={row.name} className="scm-table__row">
                    <td className="scm-table__cell scm-table__cell--link">{row.name}</td>
                    <td className="scm-table__cell">{row.date}</td>
                    <td className="scm-table__cell scm-table__cell--truncate">{row.source}</td>
                    <td className="scm-table__cell">{row.qty}</td>
                    <td className="scm-table__cell">
                      <ScmStatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ScmPanel>

        <ScmPanel
          title="Stock value trend"
          subtitle="Valuation over selected period"
          className="scm-dash-col--1"
        >
          <div className="scm-chart-wrap scm-chart-wrap--sm">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.stock_value_trend || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${(v / 100000).toFixed(0)}L`}
                />
                <Tooltip content={<StockValueTooltip />} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#14b8a6"
                  strokeWidth={2}
                  dot={{ fill: "#14b8a6", r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ScmPanel>

        <ScmPanel
          title="MR status breakdown"
          subtitle="Material request pipeline by status"
          className="scm-dash-col--1"
        >
          <div className="scm-chart-wrap scm-chart-wrap--sm">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data?.mr_status_breakdown || []}
                layout="vertical"
                margin={{ left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="status"
                  width={72}
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" fill="#14b8a6" radius={[0, 4, 4, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ScmPanel>
      </div>

      <div className="scm-dash-row--2">
        <ScmPanel
          title="Availability requests"
          subtitle="From Sales quotations and orders when material is short"
          action={
            <Link to="/supply-chain/material-requests" className="scm-link-btn--sm">
              Planning
            </Link>
          }
        >
          <div className="scm-table-scroll">
            <table className="scm-table scm-table--wider">
              <thead>
                <tr className="scm-table__row">
                  {["Request", "Ref", "Customer", "Item", "Qty", "Shortage", "Status"].map((h) => (
                    <th key={h} className="scm-table__head">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.availability_requests || []).map((row) => (
                  <tr key={row.id} className="scm-table__row">
                    <td className="scm-table__cell">{row.id}</td>
                    <td className="scm-table__cell scm-table__cell--link">{row.reference}</td>
                    <td className="scm-table__cell">{row.customer}</td>
                    <td className="scm-table__cell">{row.item_code}</td>
                    <td className="scm-table__cell">{row.qty}</td>
                    <td className="scm-table__cell scm-table__cell--truncate-wide">
                      {row.shortage_summary}
                    </td>
                    <td className="scm-table__cell">
                      <ScmStatusBadge status={row.status} tone={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ScmPanel>

        <ScmPanel title="Recent activity" subtitle="Last stock and procurement events">
          <ul className="scm-activity-list">
            {(data?.recent_activity || []).map((item) => (
              <li key={item.id} className="scm-activity-item">
                <div>
                  <p className="scm-activity-item__label">{item.label}</p>
                  <p className="scm-activity-item__detail">{item.detail}</p>
                </div>
                <span className="scm-activity-item__time">{item.time}</span>
              </li>
            ))}
          </ul>
        </ScmPanel>
      </div>

      {data?._mock ? (
        <p className="scm-mock-notice">
          Sample data shown until <code>supply_chain_app</code> APIs are connected on the bench.
        </p>
      ) : null}
    </div>
  );
}
