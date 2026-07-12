import { useEffect, useState, useCallback, useMemo } from "react";
import { callMethodGet } from "../../../common/api/client.js";
import FinanceDashboardKpiCard from "../components/FinanceDashboardKpiCard.jsx";
import FinanceEwayDashboardAlert from "../components/FinanceEwayDashboardAlert.jsx";
import FinanceBillingPipeline from "../components/FinanceBillingPipeline.jsx";
import FinancePurchasePipeline from "../components/FinancePurchasePipeline.jsx";
import FinancePageLoader from "../components/FinancePageLoader.jsx";
import { useFinanceRole } from "../hooks/useFinanceRole.js";
import { dashboardConfigForRole } from "../lib/roles.js";
import { toMethodGetUrl } from "../lib/methodUrl.js";
import { tokens } from "../theme/tokens.js";
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  HiOutlineArrowTrendingUp,
  HiOutlineArrowTrendingDown,
  HiOutlineCurrencyRupee,
  HiOutlineClipboardDocumentList,
  HiOutlineDocumentText,
  HiOutlineClock,
  HiOutlineBuildingLibrary,
  HiOutlineExclamationTriangle,
} from "react-icons/hi2";

const CHART_COLORS = [tokens.success, tokens.accent, tokens.warning, tokens.danger];
const fillMix = (color) => `color-mix(in srgb, ${color} 15%, transparent)`;

const fmt = (n) =>
  `₹ ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtK = (n) => {
  const v = Number(n || 0);
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(0)}k`;
  return `${sign}₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

const KPI_KEYS = [
  { key: "total_income", label: "Total Income", accent: tokens.success, icon: <HiOutlineArrowTrendingUp /> },
  { key: "total_expense", label: "Total Expense", accent: tokens.danger, icon: <HiOutlineArrowTrendingDown /> },
  { key: "net_profit", label: "Net Profit", accent: null, icon: <HiOutlineCurrencyRupee /> },
  { key: "total_receivable", label: "Receivable", accent: tokens.warning, icon: <HiOutlineClipboardDocumentList /> },
  { key: "total_payable", label: "Payable", accent: tokens.accent, icon: <HiOutlineDocumentText /> },
  { key: "overdue_receivable", label: "Overdue", accent: tokens.danger, icon: <HiOutlineClock /> },
  { key: "overdue_payable", label: "Overdue", accent: tokens.danger, icon: <HiOutlineClock /> },
  { key: "cash_balance", label: "Cash & Bank", accent: tokens.accent, icon: <HiOutlineBuildingLibrary /> },
  {
    key: "unreconciled_bank_count",
    label: "Unreconciled",
    accent: tokens.warning,
    icon: <HiOutlineExclamationTriangle />,
  },
];

const ChartTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="finance-chart-tip">
      {label && <p className="finance-chart-tip__label">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="finance-chart-tip__row" style={{ color: p.color || tokens.success }}>
          {p.name}: {typeof p.value === "number" ? fmtK(p.value) : p.value}
        </p>
      ))}
    </div>
  );
};

const Card = ({ title, children, className = "" }) => (
  <div className={`pm-card finance-dash-card ${className}`.trim()}>
    {title && (
      <div className="finance-dash-card__head">
        <span>{title}</span>
      </div>
    )}
    <div className="finance-dash-card__body">{children}</div>
  </div>
);

const RECENT_GL_COLUMNS = [
  { key: "posting_date", label: "Date" },
  { key: "account", label: "Account" },
  { key: "voucher_type", label: "Voucher" },
  { key: "voucher_no", label: "Reference" },
  { key: "debit", label: "Debit", align: "right", format: "currency" },
  { key: "credit", label: "Credit", align: "right", format: "currency" },
];

function StatusPieCard({ title, chartData }) {
  return (
    <Card title={title}>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={chartData}
            dataKey="count"
            nameKey="status"
            cx="50%"
            cy="50%"
            outerRadius={90}
            innerRadius={40}
            paddingAngle={3}
          >
            {chartData.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => v} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </Card>
  );
}

function DetailTable({ columns, rows }) {
  if (!rows?.length) {
    return <p className="finance-cell-muted finance-text-sm--flush">No entries found.</p>;
  }
  return (
    <div className="pm-table-wrap">
      <table className="pm-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`finance-th-nowrap ${c.align === "right" ? "finance-cell-align-right" : "finance-cell-align-left"}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.name || i}>
              {columns.map((c) => {
                const val = row[c.key];
                const display = c.format === "currency" ? fmt(val) : (val ?? "—");
                return (
                  <td
                    key={c.key}
                    className={[
                      c.align === "right" ? "finance-cell-align-right" : "finance-cell-align-left",
                      c.key === "name" ? "finance-cell-accent pm-cell-nowrap" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KpiDetailModal({ detail, loading, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!detail && !loading) return null;

  return (
    <div role="presentation" className="finance-modal-overlay" onClick={onClose}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="finance-drill-modal">
        <div className="finance-drill-modal__head">
          <div>
            <h2 className="finance-drill-modal__title">{loading ? "Loading…" : detail?.title}</h2>
            {!loading && detail?.description && (
              <p className="finance-detail-sub">{detail.description}</p>
            )}
            {!loading && detail?.count != null && (
              <p className="pm-field-hint finance-drill-modal__count">
                {detail.count} {detail.count === 1 ? "entry" : "entries"}
                {detail.total != null && (
                  <>
                    {" "}
                    · Total: <strong className="finance-cell-title">{fmt(detail.total)}</strong>
                  </>
                )}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="pm-btn finance-modal-close">
            ×
          </button>
        </div>
        <div className="finance-drill-modal__body">
          {loading && <FinancePageLoader message="Loading entries…" />}
          {!loading && detail?.status === "error" && (
            <p className="finance-cell-danger">{detail.message}</p>
          )}
          {!loading &&
            detail?.sections?.map((sec, idx) => (
              <div key={idx} className="finance-drill-section">
                <div className="finance-drill-section__head">
                  <h3 className="finance-drill-section__title">{sec.title}</h3>
                  <span className={`finance-text-sm ${idx === 0 ? "finance-cell-success" : "finance-cell-danger"}`}>
                    {fmt(sec.total)}
                  </span>
                </div>
                <DetailTable columns={sec.columns} rows={sec.rows} />
              </div>
            ))}
          {!loading && detail?.columns && (
            <DetailTable columns={detail.columns} rows={detail.rows} />
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { financeRole } = useFinanceRole();
  const dashConfig = useMemo(() => dashboardConfigForRole(financeRole), [financeRole]);
  const kpiItems = useMemo(
    () =>
      dashConfig.kpiKeys
        .map((key) => {
          const base = KPI_KEYS.find((k) => k.key === key);
          if (!base) return null;
          const label = dashConfig.kpiLabels[key] || base.label;
          return { ...base, label };
        })
        .filter(Boolean),
    [dashConfig]
  );
  const kpiRowChunks = useMemo(() => {
    if (dashConfig.kpiRows?.length) {
      let idx = 0;
      return dashConfig.kpiRows
        .map((cols) => {
          const items = kpiItems.slice(idx, idx + cols);
          idx += cols;
          return { cols, items };
        })
        .filter((row) => row.items.length > 0);
    }
    const top = kpiItems.slice(0, 3);
    const bottom = kpiItems.length > 3 ? kpiItems.slice(3) : [];
    return [
      { cols: 3, items: top },
      ...(bottom.length ? [{ cols: 3, items: bottom }] : []),
    ];
  }, [dashConfig.kpiRows, kpiItems]);
  const chartGridClass =
    dashConfig.chartLayout === "triple"
      ? "finance-chart-grid finance-chart-grid--triple"
      : dashConfig.chartLayout === "single"
        ? "finance-chart-grid finance-chart-grid--single"
        : "finance-chart-grid finance-chart-grid--wide";
  const [data, setData] = useState(null);
  const [pipelines, setPipelines] = useState(null);
  const [pipelinesLoading, setPipelinesLoading] = useState(true);
  const [error, setError] = useState(null);
  const [drillDown, setDrillDown] = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const loadPipelines = useCallback(async () => {
    setPipelinesLoading(true);
    try {
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.dashboard.dashboard_pipeline_data")
      );
      if (message?.status === "success" || message?.sales_billing_pipeline) {
        setPipelines({
          sales_billing_pipeline: message.sales_billing_pipeline || { queues: [], total_actionable: 0 },
          purchase_procurement_pipeline:
            message.purchase_procurement_pipeline || { queues: [], total_actionable: 0 },
        });
      }
    } catch {
      setPipelines({
        sales_billing_pipeline: { queues: [], total_actionable: 0 },
        purchase_procurement_pipeline: { queues: [], total_actionable: 0 },
      });
    }
    setPipelinesLoading(false);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.dashboard.dashboard_data")
      );
      if (message) setData(message);
      else setError("Invalid API response");
    } catch {
      setError("Failed to load dashboard. Make sure finance_app is installed.");
    }
  }, []);

  useEffect(() => {
    loadData();
    loadPipelines();
  }, [loadData, loadPipelines]);

  const openKpiDetail = useCallback(async (kpiKey) => {
    setDrillLoading(true);
    const item = kpiItems.find((k) => k.key === kpiKey);
    setDrillDown({ title: item?.label || "Details" });
    try {
      const msg = await callMethodGet(
        toMethodGetUrl("finance_app.api.dashboard.get_kpi_details", { kpi: kpiKey })
      );
      if (msg?.status === "success") setDrillDown(msg);
      else
        setDrillDown({
          status: "error",
          title: "Details",
          message: msg?.message || "Could not load details.",
        });
    } catch (e) {
      setDrillDown({ status: "error", title: "Details", message: e.message });
    }
    setDrillLoading(false);
  }, [kpiItems]);

  const refreshDashboard = useCallback(() => {
    loadData();
    loadPipelines();
  }, [loadData, loadPipelines]);

  if (error) {
    return (
      <div className="pm-page finance-page">
        <div className="finance-center-state finance-center-state--col">
          <span className="finance-center-state__icon">⚠️</span>
          <p className="finance-center-state__error">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="pm-page finance-page">
        <div className="finance-center-state">
          <FinancePageLoader message="Loading dashboard…" />
        </div>
      </div>
    );
  }

  const k = data.kpis || {};

  const kpiValue = (key) => {
    if (key === "net_profit") return fmtK(k.net_profit);
    if (key === "unreconciled_bank_count") return String(k.unreconciled_bank_count ?? 0);
    return fmtK(k[key]);
  };

  const kpiAccent = (key) => {
    if (key === "net_profit") return (k.net_profit || 0) >= 0 ? tokens.success : tokens.danger;
    return kpiItems.find((x) => x.key === key)?.accent || KPI_KEYS.find((x) => x.key === key)?.accent || tokens.accent;
  };

  const statusChartData = data[dashConfig.statusDistributionKey] || data.status_distribution || [];
  const secondaryStatusChartData = dashConfig.showSecondaryInvoiceStatus
    ? data[dashConfig.secondaryStatusDistributionKey] || []
    : [];

  const ewayAlert = data.alerts?.pending_eway_bill;
  const billingPipeline = pipelines?.sales_billing_pipeline;
  const purchasePipeline = pipelines?.purchase_procurement_pipeline;
  const showBillingPipeline = Boolean(
    billingPipeline?.queues?.some((q) =>
      ["awaiting_fg", "ready_for_dn", "needs_verify", "ready_to_invoice", "awaiting_payment"].includes(q.key)
    )
  );
  const showPurchasePipeline = Boolean(
    purchasePipeline?.queues?.some((q) =>
      ["draft_po", "ready_for_receipt", "ready_to_invoice"].includes(q.key)
    )
  );

  return (
    <div className="pm-page finance-page">
      {(drillDown || drillLoading) && (
        <KpiDetailModal
          detail={drillDown}
          loading={drillLoading}
          onClose={() => {
            setDrillDown(null);
            setDrillLoading(false);
          }}
        />
      )}

      {kpiRowChunks.map((row, rowIdx) => (
        <div
          key={rowIdx}
          className={[
            "finance-kpi-grid",
            row.cols === 4 ? "finance-kpi-grid--cols-4" : "",
            row.cols === 3 ? "finance-kpi-grid--cols-3" : "",
            rowIdx > 0 ? "finance-kpi-grid--bottom" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {row.items.map((item) => (
            <FinanceDashboardKpiCard
              key={item.key}
              label={item.label}
              value={kpiValue(item.key)}
              icon={item.icon}
              accent={kpiAccent(item.key)}
              onClick={() => openKpiDetail(item.key)}
            />
          ))}
        </div>
      ))}

      <FinanceEwayDashboardAlert alert={ewayAlert} onSaved={refreshDashboard} />

      {pipelinesLoading && !pipelines ? (
        <div className="pm-card finance-dash-card finance-billing-pipeline">
          <FinancePageLoader message="Loading billing pipelines…" />
        </div>
      ) : null}
      {!pipelinesLoading || pipelines ? (
        <>
          {showBillingPipeline ? (
            <FinanceBillingPipeline pipeline={billingPipeline} />
          ) : null}
          {showPurchasePipeline ? (
            <FinancePurchasePipeline pipeline={purchasePipeline} />
          ) : null}
        </>
      ) : null}

      <div className={chartGridClass}>
        <Card title={dashConfig.revenueChartTitle}>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data.monthly_data || []}>
              <CartesianGrid strokeDasharray="3 3" stroke={tokens.border} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: tokens.muted }} />
              <YAxis tickFormatter={fmtK} tick={{ fontSize: 11, fill: tokens.muted }} />
              <Tooltip content={<ChartTip />} />
              <Legend />
              {dashConfig.showRevenueOnChart !== false ? (
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke={tokens.success}
                  fill={fillMix(tokens.success)}
                  name={dashConfig.chartRevenueName || "Revenue"}
                  strokeWidth={2}
                />
              ) : null}
              {dashConfig.showExpenseOnChart ? (
                <Area
                  type="monotone"
                  dataKey="expense"
                  stroke={tokens.danger}
                  fill={fillMix(tokens.danger)}
                  name={
                    dashConfig.chartExpenseName ||
                    (dashConfig.showRevenueOnChart === false ? "Vendor Bills" : "Expense")
                  }
                  strokeWidth={2}
                />
              ) : null}
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        {dashConfig.showInvoiceStatus ? (
          <StatusPieCard title={dashConfig.invoiceStatusTitle || "Invoice Status"} chartData={statusChartData} />
        ) : null}
        {dashConfig.showSecondaryInvoiceStatus ? (
          <StatusPieCard
            title={dashConfig.secondaryInvoiceStatusTitle || "Supplier Invoice Status"}
            chartData={secondaryStatusChartData}
          />
        ) : null}
      </div>

      {dashConfig.showTopCustomers || dashConfig.showTopSuppliers ? (
        <div className="finance-chart-grid">
          {dashConfig.showTopCustomers ? (
            <Card title="Top Customers">
              {(data.top_customers || []).map((c, i) => (
                <div
                  key={i}
                  className={`finance-top-list-item${i < (data.top_customers || []).length - 1 ? " finance-top-list-item--bordered" : ""}`}
                >
                  <span className="finance-cell-title finance-text-sm">{c.customer}</span>
                  <span className="finance-cell-success finance-text-sm">{fmtK(c.total)}</span>
                </div>
              ))}
              {!(data.top_customers || []).length && (
                <p className="finance-cell-muted finance-text-sm">No data</p>
              )}
            </Card>
          ) : null}

          {dashConfig.showTopSuppliers ? (
            <Card title="Top Suppliers">
              {(data.top_suppliers || []).map((s, i) => (
                <div
                  key={i}
                  className={`finance-top-list-item${i < (data.top_suppliers || []).length - 1 ? " finance-top-list-item--bordered" : ""}`}
                >
                  <span className="finance-cell-title finance-text-sm">{s.supplier}</span>
                  <span className="finance-cell-danger finance-text-sm">{fmtK(s.total)}</span>
                </div>
              ))}
              {!(data.top_suppliers || []).length && (
                <p className="finance-cell-muted finance-text-sm">No data</p>
              )}
            </Card>
          ) : null}
        </div>
      ) : null}

      {dashConfig.showRecentEntries ? (
        <Card title={dashConfig.recentEntriesTitle || "Recent GL Activity"}>
          <div className="finance-dash-recent-gl-scroll">
            <DetailTable
              columns={RECENT_GL_COLUMNS}
              rows={data[dashConfig.recentEntriesKey || "recent_entries"] || []}
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
