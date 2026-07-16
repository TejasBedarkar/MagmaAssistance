import { useEffect, useState, useCallback } from "react";
import { callMethodGet } from "../../../common/api/client.js";
import FinanceFormField from "../components/FinanceFormField.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";
import FinancePageLoader from "../components/FinancePageLoader.jsx";
import { defaultReportPeriodDates } from "../lib/reportDateDefaults.js";
import { toMethodGetUrl } from "../lib/methodUrl.js";
import { tokens } from "../theme/tokens.js";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

const CHART_COLORS = [tokens.success, tokens.accent, tokens.warning, tokens.danger];

const fmt = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN")}`;
const fmtK = (n) => {
  n = Number(n || 0);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(0)}k`;
  return `₹${n}`;
};

/** Net margin % — hide extreme values when loss/profit dwarfs income. */
function formatNetMargin(totalIncome, netProfit) {
  const income = Number(totalIncome || 0);
  if (income <= 0) return "0%";
  const margin = (Number(netProfit || 0) / income) * 100;
  if (Math.abs(margin) > 100) return "—";
  return `${margin.toFixed(1)}%`;
}

const tooltipStyle = {
  background: tokens.surface,
  border: `1px solid ${tokens.border}`,
  borderRadius: 10,
};

const INITIAL_DATES = defaultReportPeriodDates();

export default function ProfitLoss() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fromDate, setFromDate] = useState(INITIAL_DATES.fromDate);
  const [toDate, setToDate] = useState(INITIAL_DATES.toDate);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.general_ledger.get_profit_loss", {
          from_date: fromDate,
          to_date: toDate,
        })
      );
      if (message) {
        setData(message);
      } else {
        setData(null);
        setError("Invalid profit & loss response from server.");
      }
    } catch (e) {
      setData(null);
      setError(e?.message || "Failed to load profit & loss. Check finance_app and company setup.");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="pm-page finance-page">
        <div className="finance-center-state">
          <FinancePageLoader message="Loading…" />
        </div>
      </div>
    );
  }

  if (error) {
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

  const income = data?.income || [];
  const expense = data?.expense || [];
  const totalIncome = data?.total_income || 0;
  const totalExpense = data?.total_expense || 0;
  const netProfit = data?.net_profit || 0;
  const isProfit = netProfit >= 0;

  const incomePie = income.map((r, i) => ({
    name: r.account?.split(" -")[0],
    value: Math.abs(r.amount),
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));
  const expensePie = expense.map((r, i) => ({
    name: r.account?.split(" -")[0],
    value: Math.abs(r.amount),
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  return (
    <div className="pm-page finance-page">
      <FinancePageHeader>
        <div className="finance-filter-row finance-filter-row--triple">
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

      <div className={`finance-hero ${isProfit ? "finance-hero--profit" : "finance-hero--loss"}`}>
        <div>
          <div className="finance-hero__label">{isProfit ? "Net Profit" : "Net Loss"}</div>
          <div className="finance-hero__value">{fmtK(Math.abs(netProfit))}</div>
        </div>
        <div className="finance-hero__stats">
          <div className="finance-hero__stat">
            <div className="finance-hero__stat-label">Total Income</div>
            <div className="finance-hero__stat-value">{fmtK(totalIncome)}</div>
          </div>
          <div className="finance-hero__stat">
            <div className="finance-hero__stat-label">Total Expense</div>
            <div className="finance-hero__stat-value">{fmtK(totalExpense)}</div>
          </div>
          <div className="finance-hero__stat">
            <div className="finance-hero__stat-label">Net margin</div>
            <div className="finance-hero__stat-value">{formatNetMargin(totalIncome, netProfit)}</div>
          </div>
        </div>
      </div>

      <div className="finance-chart-grid">
        <div className="pm-card">
          <h3 className="finance-chart-title">Income Breakdown</h3>
          {incomePie.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={incomePie}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  innerRadius={35}
                  paddingAngle={3}
                >
                  {incomePie.map((e, i) => (
                    <Cell key={i} fill={e.fill} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="finance-empty-chart">No income data</p>
          )}
        </div>
        <div className="pm-card">
          <h3 className="finance-chart-title">Expense Breakdown</h3>
          {expensePie.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={expensePie}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  innerRadius={35}
                  paddingAngle={3}
                >
                  {expensePie.map((e, i) => (
                    <Cell key={i} fill={e.fill} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="finance-empty-chart">No expense data</p>
          )}
        </div>
      </div>

      <div className="finance-chart-grid">
        <div className="pm-card finance-dash-card">
          <div className="finance-dash-card__head finance-pl-head--income">
            <span>Income Accounts</span>
          </div>
          <div className="pm-table-wrap finance-table-wrap--flush">
            <table className="pm-table">
              <tbody>
                {income.map((r, i) => (
                  <tr key={i}>
                    <td className="finance-cell-title">{r.account?.split(" -")[0]}</td>
                    <td className="finance-cell-success finance-cell-align-right">
                      {fmt(r.amount)}
                    </td>
                  </tr>
                ))}
                <tr className="finance-table-total-row">
                  <td className="finance-cell-title finance-cell-total-label">
                    Total Income
                  </td>
                  <td className="finance-cell-success finance-footer-total">{fmt(totalIncome)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="pm-card finance-dash-card">
          <div className="finance-dash-card__head finance-pl-head--expense">
            <span>Expense Accounts</span>
          </div>
          <div className="pm-table-wrap finance-table-wrap--flush">
            <table className="pm-table">
              <tbody>
                {expense.map((r, i) => (
                  <tr key={i}>
                    <td className="finance-cell-title">{r.account?.split(" -")[0]}</td>
                    <td className="finance-cell-danger finance-cell-align-right">
                      {fmt(r.amount)}
                    </td>
                  </tr>
                ))}
                <tr className="finance-table-total-row">
                  <td className="finance-cell-title finance-cell-total-label">
                    Total Expense
                  </td>
                  <td className="finance-cell-danger finance-footer-total">{fmt(totalExpense)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
