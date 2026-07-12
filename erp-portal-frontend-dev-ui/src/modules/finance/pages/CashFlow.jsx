import { useEffect, useState, useCallback, useMemo } from "react";
import {
  HiOutlineArrowsRightLeft,
  HiOutlineArrowPath,
  HiOutlineBanknotes,
  HiOutlineBuildingLibrary,
  HiOutlineBuildingOffice2,
  HiOutlineCalendarDays,
} from "react-icons/hi2";
import { callMethodGet } from "../../../common/api/client.js";
import FinanceDrillDownModal from "../components/FinanceDrillDownModal.jsx";
import FinanceFormField from "../components/FinanceFormField.jsx";
import FinanceKpiCard from "../components/FinanceKpiCard.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";
import FinancePageLoader from "../components/FinancePageLoader.jsx";
import { buildCashFlowKpiDetail } from "../lib/cashFlowDrillDown.js";
import { defaultReportPeriodDates } from "../lib/reportDateDefaults.js";
import { toMethodGetUrl } from "../lib/methodUrl.js";
import { tokens } from "../theme/tokens.js";

const roundInr = (n) => Math.round(Number(n || 0) * 100) / 100;

const fmt = (n) => {
  const v = roundInr(n);
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  return `${sign}₹ ${abs.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

const fmtK = (n) => {
  const v = roundInr(n);
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(0)}k`;
  return `${sign}₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

function SectionTable({
  title,
  headClass,
  lines,
  total,
  totalLabel,
  valueClass = "finance-cell-success",
  className = "",
}) {
  return (
    <div className={`pm-card finance-dash-card ${className}`.trim()}>
      <div className={`finance-dash-card__head ${headClass}`}>
        <span>{title}</span>
      </div>
      <div className="pm-table-wrap finance-table-wrap--flush">
        <table className="pm-table">
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={2} className="finance-cell-muted">
                  No activity in this period
                </td>
              </tr>
            ) : (
              lines.map((r, i) => (
                <tr key={`${r.label}-${i}`}>
                  <td className={`finance-cell-title ${r.is_net_profit ? "finance-cell-accent" : ""}`}>
                    {r.label}
                  </td>
                  <td className={`${valueClass} finance-cell-align-right`}>{fmt(r.amount)}</td>
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

const CASH_FLOW_KPIS = [
  { key: "operating", label: "Net Cash from Operations" },
  { key: "investing", label: "Net Cash from Investing" },
  { key: "financing", label: "Net Cash from Financing" },
  { key: "net_change", label: "Net Change in Cash" },
  { key: "opening_cash", label: "Opening Cash" },
  { key: "closing_cash", label: "Closing Cash" },
];

const INITIAL_DATES = defaultReportPeriodDates();

export default function CashFlow() {
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
        toMethodGetUrl("finance_app.api.general_ledger.get_cash_flow", {
          from_date: fromDate,
          to_date: toDate,
        })
      );
      if (message) {
        setData(message);
      } else {
        setData(null);
        setError("Invalid cash flow response from server.");
      }
    } catch (e) {
      setData(null);
      setError(e?.message || "Failed to load cash flow. Check finance_app and company setup.");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    load();
  }, []);

  const openKpiDetail = useCallback(
    (kpiKey) => {
      const item = CASH_FLOW_KPIS.find((k) => k.key === kpiKey);
      setDrillDown(buildCashFlowKpiDetail(kpiKey, data) || { title: item?.label || "Details" });
    },
    [data]
  );

  const closeKpiDetail = useCallback(() => setDrillDown(null), []);

  const kpiHandlers = useMemo(
    () =>
      Object.fromEntries(CASH_FLOW_KPIS.map((k) => [k.key, () => openKpiDetail(k.key)])),
    [openKpiDetail]
  );

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

  const operating = data?.operating?.lines || [];
  const investing = data?.investing?.lines || [];
  const financing = data?.financing?.lines || [];
  const operatingTotal = data?.operating?.total ?? 0;
  const investingTotal = data?.investing?.total ?? 0;
  const financingTotal = data?.financing?.total ?? 0;

  return (
    <div className="pm-page finance-page">
      {drillDown ? <FinanceDrillDownModal detail={drillDown} loading={false} onClose={closeKpiDetail} /> : null}

      <FinancePageHeader
        title="Cash Flow Statement"
        description="Indirect method — operations, investing, and financing for the selected period."
      >
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

      <div className="finance-stat-grid finance-stat-grid--3 finance-stat-grid--equal">
        <FinanceKpiCard
          className="finance-stat-grid__item"
          label="Net Cash from Operations"
          value={fmtK(operatingTotal)}
          tone={operatingTotal >= 0 ? "success" : "danger"}
          icon={<HiOutlineArrowPath size={22} />}
          iconAccent={tokens.success}
          onClick={kpiHandlers.operating}
        />
        <FinanceKpiCard
          className="finance-stat-grid__item"
          label="Net Cash from Investing"
          value={fmtK(investingTotal)}
          tone={investingTotal >= 0 ? "success" : "warn"}
          icon={<HiOutlineBuildingOffice2 size={22} />}
          iconAccent={tokens.warning}
          onClick={kpiHandlers.investing}
        />
        <FinanceKpiCard
          className="finance-stat-grid__item"
          label="Net Cash from Financing"
          value={fmtK(financingTotal)}
          tone={financingTotal >= 0 ? "success" : "warn"}
          icon={<HiOutlineBanknotes size={22} />}
          iconAccent={tokens.accent}
          onClick={kpiHandlers.financing}
        />
      </div>

      <div className="finance-stat-grid finance-stat-grid--3 finance-stat-grid--equal finance-card--spaced">
        <FinanceKpiCard
          label="Net Change in Cash"
          value={fmtK(data?.net_change_in_cash)}
          accentClass="finance-stat-tile__value--accent"
          className="finance-stat-grid__item"
          sub={data?.from_date && data?.to_date ? `${data.from_date} → ${data.to_date}` : "\u00a0"}
          icon={<HiOutlineArrowsRightLeft size={22} />}
          iconAccent={tokens.accent}
          onClick={kpiHandlers.net_change}
        />
        <FinanceKpiCard
          label="Opening Cash"
          value={fmtK(data?.opening_cash)}
          className="finance-stat-grid__item"
          sub="Cash & bank before period"
          icon={<HiOutlineCalendarDays size={22} />}
          iconAccent={tokens.muted}
          onClick={kpiHandlers.opening_cash}
        />
        <FinanceKpiCard
          label="Closing Cash"
          value={fmtK(data?.closing_cash)}
          className="finance-stat-grid__item"
          tone={data?.is_reconciled ? "success" : "warn"}
          sub={data?.is_reconciled ? "Reconciled with GL" : "Check reconciliation"}
          icon={<HiOutlineBuildingLibrary size={22} />}
          iconAccent={data?.is_reconciled ? tokens.success : tokens.warning}
          onClick={kpiHandlers.closing_cash}
        />
      </div>

      <div className="finance-chart-grid finance-cash-flow-sections">
        <SectionTable
          className="finance-cash-flow-section--full"
          title="Cash Flow from Operations"
          headClass="finance-pl-head--income"
          lines={operating}
          total={data?.operating?.total}
          totalLabel="Net Cash from Operations"
          valueClass="finance-cell-success"
        />
        <SectionTable
          title="Cash Flow from Investing"
          headClass="finance-pl-head--expense"
          lines={investing}
          total={data?.investing?.total}
          totalLabel="Net Cash from Investing"
          valueClass="finance-cell-danger"
        />
        <SectionTable
          title="Cash Flow from Financing"
          headClass="finance-pl-head--income"
          lines={financing}
          total={data?.financing?.total}
          totalLabel="Net Cash from Financing"
          valueClass="finance-cell-accent"
        />
      </div>
    </div>
  );
}
