import { useEffect, useState, useCallback } from "react";
import { callMethodGet } from "../../../common/api/client.js";
import FinanceFormField from "../components/FinanceFormField.jsx";
import FinanceKpiCard from "../components/FinanceKpiCard.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";
import FinancePageLoader from "../components/FinancePageLoader.jsx";
import { defaultAsOnDate } from "../lib/reportDateDefaults.js";
import { toMethodGetUrl } from "../lib/methodUrl.js";

const roundInr = (n) => Math.round(Number(n || 0) * 100) / 100;

const fmt = (n) => {
  const v = roundInr(n);
  return `₹ ${v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

/** Compact KPI format — handles negative amounts (liabilities) without float noise. */
const fmtK = (n) => {
  const v = roundInr(n);
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(0)}k`;
  return `${sign}₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

const accountLabel = (account) => account?.split(" -")[0] || account || "—";

function SectionTable({ title, headClass, rows, total, totalLabel, valueClass = "finance-cell-success" }) {
  return (
    <div className="pm-card finance-dash-card">
      <div className={`finance-dash-card__head ${headClass}`}>
        <span>{title}</span>
      </div>
      <div className="pm-table-wrap finance-table-wrap--flush">
        <table className="pm-table">
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={2} className="finance-cell-muted">
                  No accounts with balance
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={`${r.account}-${i}`}>
                  <td className={`finance-cell-title ${r.is_provisional ? "finance-cell-muted" : ""}`}>
                    {accountLabel(r.account)}
                  </td>
                  <td className={`${valueClass} finance-cell-align-right`}>{fmt(r.balance)}</td>
                </tr>
              ))
            )}
            <tr className="finance-table-total-row">
              <td className="finance-cell-title finance-cell-total-label">{totalLabel}</td>
              <td className={`${valueClass} finance-footer-total`}>{fmt(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function BalanceSheet() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [asOnDate, setAsOnDate] = useState(defaultAsOnDate);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.general_ledger.get_balance_sheet", {
          as_on_date: asOnDate,
        })
      );
      if (message) {
        setData(message);
      } else {
        setData(null);
        setError("Invalid balance sheet response from server.");
      }
    } catch (e) {
      setData(null);
      setError(e?.message || "Failed to load balance sheet. Check finance_app and company setup.");
    } finally {
      setLoading(false);
    }
  }, [asOnDate]);

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

  const assets = data?.assets || [];
  const liabilities = data?.liabilities || [];
  const equity = data?.equity || [];

  return (
    <div className="pm-page finance-page">
      <FinancePageHeader
        title="Balance Sheet"
        description="Assets, liabilities, and equity as on the selected date."
      >
        <div className="finance-filter-row finance-filter-row--double finance-filter-row--max-520">
          <FinanceFormField
            label="As on Date"
            type="date"
            value={asOnDate}
            onChange={(e) => setAsOnDate(e.target.value)}
            className="finance-field--flush"
          />
          <button type="button" className="pm-btn pm-btn-primary finance-filter-row__btn" onClick={load}>
            Refresh
          </button>
        </div>
      </FinancePageHeader>

      <div className="finance-stat-grid finance-stat-grid--3">
        <FinanceKpiCard label="Total Assets" value={fmtK(data?.total_assets)} tone="success" />
        <FinanceKpiCard label="Total Liabilities" value={fmtK(data?.total_liabilities)} tone="danger" />
        <FinanceKpiCard
          label="Balance Status"
          value={data?.is_balanced ? "✓ Balanced" : "✗ Check totals"}
          tone={data?.is_balanced ? "success" : "warn"}
        />
      </div>

      <div className="finance-stat-grid finance-stat-grid--2 finance-stat-grid--equal finance-card--spaced">
        <FinanceKpiCard
          label="Total Equity"
          value={fmtK(data?.total_equity)}
          accentClass="finance-stat-tile__value--accent"
          className="finance-stat-grid__item"
          sub={data?.as_on_date ? `As on ${data.as_on_date}` : "\u00a0"}
        />
        <FinanceKpiCard
          label="Liabilities + Equity"
          value={fmtK(data?.liabilities_and_equity)}
          className="finance-stat-grid__item"
          sub={data?.as_on_date ? `As on ${data.as_on_date}` : "\u00a0"}
        />
      </div>

      <div className="finance-chart-grid">
        <SectionTable
          title="Assets"
          headClass="finance-pl-head--income"
          rows={assets}
          total={data?.total_assets}
          totalLabel="Total Assets"
          valueClass="finance-cell-success"
        />
        <SectionTable
          title="Liabilities"
          headClass="finance-pl-head--expense"
          rows={liabilities}
          total={data?.total_liabilities}
          totalLabel="Total Liabilities"
          valueClass="finance-cell-danger"
        />
      </div>

      <SectionTable
        title="Equity"
        headClass="finance-pl-head--income"
        rows={equity}
        total={data?.total_equity}
        totalLabel="Total Equity"
        valueClass="finance-cell-accent"
      />
    </div>
  );
}
