import { useEffect, useState, useCallback, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { callMethodGet } from "../../../common/api/client.js";
import FinanceDataTable, { FINANCE_LIST_PAGE_SIZE } from "../components/FinanceDataTable.jsx";
import FinanceDrillDownModal from "../components/FinanceDrillDownModal.jsx";
import FinanceKpiCard from "../components/FinanceKpiCard.jsx";
import FinanceFormField from "../components/FinanceFormField.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";
import { defaultReportPeriodDates } from "../lib/reportDateDefaults.js";
import { toMethodGetUrl } from "../lib/methodUrl.js";
import FinancePageLoader from "../components/FinancePageLoader.jsx";
import { buildTrialBalanceKpiDetail } from "../lib/trialBalanceDrillDown.js";
import { tokens } from "../theme/tokens.js";

const fmt = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN")}`;
const fmtK = (n) => {
  n = Number(n || 0);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(0)}k`;
  return `₹${n}`;
};

const TB_KPIS = [
  { key: "total_debit", label: "Total Debit" },
  { key: "total_credit", label: "Total Credit" },
  { key: "balance_status", label: "Balance Status" },
];

const INITIAL_DATES = defaultReportPeriodDates();

export default function TrialBalance() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fromDate, setFromDate] = useState(INITIAL_DATES.fromDate);
  const [toDate, setToDate] = useState(INITIAL_DATES.toDate);
  const [drillDown, setDrillDown] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.general_ledger.get_trial_balance", {
          from_date: fromDate,
          to_date: toDate,
        })
      );
      if (message) {
        setData(message);
      } else {
        setData(null);
        setError("Invalid trial balance response from server.");
      }
    } catch (e) {
      setData(null);
      setError(e?.message || "Failed to load trial balance. Check finance_app and company setup.");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    load();
  }, []);

  const columns = useMemo(
    () => [
      {
        key: "account",
        label: "Account",
        render: (e) => <span className="finance-cell-title">{e.account?.split(" -")[0]}</span>,
      },
      {
        key: "debit",
        label: "Debit",
        align: "right",
        render: (e) => (
          <span className={e.debit > 0 ? "finance-cell-success" : "finance-cell-muted"}>
            {e.debit > 0 ? fmt(e.debit) : "—"}
          </span>
        ),
      },
      {
        key: "credit",
        label: "Credit",
        align: "right",
        render: (e) => (
          <span className={e.credit > 0 ? "finance-cell-danger" : "finance-cell-muted"}>
            {e.credit > 0 ? fmt(e.credit) : "—"}
          </span>
        ),
      },
      {
        key: "balance",
        label: "Balance",
        align: "right",
        render: (e) => (
          <span className={e.balance >= 0 ? "finance-cell-success" : "finance-cell-danger"}>
            {fmt(e.balance)}
          </span>
        ),
      },
    ],
    []
  );

  const filterContext = useMemo(() => ({ fromDate, toDate }), [fromDate, toDate]);

  const openKpiDetail = useCallback(
    (kpiKey) => {
      const item = TB_KPIS.find((k) => k.key === kpiKey);
      setDrillDown(
        buildTrialBalanceKpiDetail(kpiKey, data, filterContext) || {
          title: item?.label || "Details",
        }
      );
    },
    [data, filterContext]
  );

  const closeKpiDetail = useCallback(() => setDrillDown(null), []);

  const kpiHandlers = useMemo(
    () => Object.fromEntries(TB_KPIS.map((k) => [k.key, () => openKpiDetail(k.key)])),
    [openKpiDetail]
  );

  if (loading && !data && !error) {
    return (
      <div className="pm-page finance-page">
        <div className="finance-center-state">
          <FinancePageLoader message="Loading…" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="pm-page finance-page">
        <div className="finance-center-state finance-center-state--col">
          <span className="finance-center-state__icon">⚠️</span>
          <p className="finance-center-state__error">{error}</p>
          <button type="button" className="pm-btn pm-btn-primary" onClick={load}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const entries = data?.entries || [];
  const chartData = entries
    .filter((e) => Math.abs(e.balance) > 100)
    .slice(0, 15)
    .map((e) => ({
      account: e.account?.split(" -")[0]?.slice(0, 20),
      debit: parseFloat(e.debit) || 0,
      credit: parseFloat(e.credit) || 0,
    }));

  const footer = (
    <>
      <td className="finance-footer-label finance-footer-label--left">
        TOTAL
      </td>
      <td className="finance-footer-total finance-cell-success">{fmt(data?.total_debit)}</td>
      <td className="finance-footer-total finance-cell-danger">{fmt(data?.total_credit)}</td>
      <td className={`finance-footer-total ${data?.is_balanced ? "finance-cell-success" : "finance-cell-danger"}`}>
        {fmt((data?.total_debit || 0) - (data?.total_credit || 0))}
      </td>
    </>
  );

  return (
    <div className="pm-page finance-page">
      {drillDown ? <FinanceDrillDownModal detail={drillDown} loading={false} onClose={closeKpiDetail} /> : null}

      <FinancePageHeader>
        <div className="finance-filter-row finance-filter-row--triple finance-filter-row--max-520">
          <FinanceFormField
            label="From Date"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="finance-field--flush"
          />
          <FinanceFormField
            label="To Date"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="finance-field--flush"
          />
          <button type="button" className="pm-btn pm-btn-primary finance-filter-row__btn" onClick={load}>
            Refresh
          </button>
        </div>
      </FinancePageHeader>

      <div className="finance-stat-grid finance-stat-grid--3 finance-stat-grid--equal finance-filter-grid--spaced">
        <FinanceKpiCard
          className="finance-stat-grid__item"
          label="Total Debit"
          value={fmtK(data?.total_debit)}
          tone="success"
          onClick={kpiHandlers.total_debit}
        />
        <FinanceKpiCard
          className="finance-stat-grid__item"
          label="Total Credit"
          value={fmtK(data?.total_credit)}
          tone="danger"
          onClick={kpiHandlers.total_credit}
        />
        <FinanceKpiCard
          className="finance-stat-grid__item"
          label="Balance Status"
          value={data?.is_balanced ? "✓ Balanced" : "✗ Not Balanced"}
          tone={data?.is_balanced ? "success" : "danger"}
          onClick={kpiHandlers.balance_status}
        />
      </div>

      {chartData.length > 0 && (
        <div className="pm-card finance-card--spaced">
          <h3 className="finance-chart-title">Top Accounts by Volume</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke={tokens.border} />
              <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 11, fill: tokens.muted }} />
              <YAxis type="category" dataKey="account" tick={{ fontSize: 10, fill: tokens.muted }} width={140} />
              <Tooltip
                contentStyle={{ background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 10 }}
                formatter={(v) => fmt(v)}
              />
              <Bar dataKey="debit" fill={tokens.success} name="Debit" radius={[0, 4, 4, 0]} />
              <Bar dataKey="credit" fill={tokens.danger} name="Credit" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <FinanceDataTable
        columns={columns}
        rows={entries}
        pageSize={FINANCE_LIST_PAGE_SIZE}
        loading={loading}
        emptyMessage="No data"
        getRowKey={(row, index) => row.account || index}
        footer={footer}
      />
    </div>
  );
}
