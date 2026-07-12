import { useEffect, useState, useCallback, useMemo } from "react";
import { callMethodGet } from "../../../common/api/client.js";
import FinanceDataTable, { FINANCE_LIST_PAGE_SIZE } from "../components/FinanceDataTable.jsx";
import FinanceDrillDownModal from "../components/FinanceDrillDownModal.jsx";
import FinanceKpiCard from "../components/FinanceKpiCard.jsx";
import FinanceFormField from "../components/FinanceFormField.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";
import FinancePageLoader from "../components/FinancePageLoader.jsx";
import { buildGeneralLedgerKpiDetail } from "../lib/generalLedgerDrillDown.js";
import { defaultReportPeriodDates } from "../lib/reportDateDefaults.js";
import { toMethodGetUrl } from "../lib/methodUrl.js";

const fmt = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN")}`;

const fmtK = (n) => {
  const v = Number(n || 0);
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(0)}k`;
  return `${sign}₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

const GL_KPIS = [
  { key: "total_debit", label: "Total Debit" },
  { key: "total_credit", label: "Total Credit" },
  { key: "net_balance", label: "Net Balance" },
];

const VOUCHER_TYPES = ["Sales Invoice", "Purchase Invoice", "Payment Entry", "Journal Entry", "Expense Claim"];
const INITIAL_DATES = defaultReportPeriodDates();

export default function GeneralLedger() {
  const [entries, setEntries] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [account, setAccount] = useState("");
  const [fromDate, setFromDate] = useState(INITIAL_DATES.fromDate);
  const [toDate, setToDate] = useState(INITIAL_DATES.toDate);
  const [voucherType, setVoucherType] = useState("");
  const [drillDown, setDrillDown] = useState(null);

  const loadAccounts = useCallback(async () => {
    try {
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.general_ledger.get_accounts")
      );
      setAccounts(message || []);
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        from_date: fromDate,
        to_date: toDate,
      };
      if (account) params.account = account;
      if (voucherType) params.voucher_type = voucherType;
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.general_ledger.get_gl_entries", params)
      );
      setEntries(Array.isArray(message) ? message : []);
      if (!Array.isArray(message)) {
        setError("Invalid general ledger response from server.");
      }
    } catch (e) {
      setEntries([]);
      setError(e?.message || "Failed to load general ledger. Check finance_app and company setup.");
    } finally {
      setLoading(false);
    }
  }, [account, fromDate, toDate, voucherType]);

  useEffect(() => {
    loadAccounts();
    load();
  }, []);

  const columns = useMemo(
    () => [
      {
        key: "posting_date",
        label: "Date",
        render: (e) => <span className="finance-cell-muted pm-cell-nowrap">{e.posting_date}</span>,
      },
      {
        key: "account",
        label: "Account",
        render: (e) => (
          <span className="finance-cell-title finance-cell-ellipsis finance-cell-block">
            {e.account?.split(" -")[0]}
          </span>
        ),
      },
      {
        key: "voucher_type",
        label: "Voucher Type",
        render: (e) => <span className="finance-voucher-pill">{e.voucher_type}</span>,
      },
      {
        key: "voucher_no",
        label: "Voucher No",
        render: (e) => <span className="finance-cell-accent">{e.voucher_no}</span>,
      },
      {
        key: "party",
        label: "Party",
        render: (e) => <span className="finance-cell-muted">{e.party || "—"}</span>,
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
    ],
    []
  );

  const totalDr = useMemo(
    () => entries.reduce((s, e) => s + (parseFloat(e.debit) || 0), 0),
    [entries]
  );
  const totalCr = useMemo(
    () => entries.reduce((s, e) => s + (parseFloat(e.credit) || 0), 0),
    [entries]
  );
  const netBalance = totalDr - totalCr;

  const filterContext = useMemo(
    () => ({ fromDate, toDate, account, voucherType }),
    [fromDate, toDate, account, voucherType]
  );

  const openKpiDetail = useCallback(
    (kpiKey) => {
      const item = GL_KPIS.find((k) => k.key === kpiKey);
      setDrillDown(
        buildGeneralLedgerKpiDetail(kpiKey, entries, filterContext) || {
          title: item?.label || "Details",
        }
      );
    },
    [entries, filterContext]
  );

  const closeKpiDetail = useCallback(() => setDrillDown(null), []);

  const kpiHandlers = useMemo(
    () => Object.fromEntries(GL_KPIS.map((k) => [k.key, () => openKpiDetail(k.key)])),
    [openKpiDetail]
  );

  if (loading && entries.length === 0 && !error) {
    return (
      <div className="pm-page finance-page">
        <div className="finance-center-state">
          <FinancePageLoader message="Loading…" />
        </div>
      </div>
    );
  }

  if (error && entries.length === 0) {
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

  const footer = (
    <>
      <td colSpan={5} className="finance-footer-label">
        Total
      </td>
      <td className="finance-footer-total finance-cell-success">{fmt(totalDr)}</td>
      <td className="finance-footer-total finance-cell-danger">{fmt(totalCr)}</td>
    </>
  );

  return (
    <div className="pm-page finance-page">
      {drillDown ? <FinanceDrillDownModal detail={drillDown} loading={false} onClose={closeKpiDetail} /> : null}

      <FinancePageHeader title="Filters">
        <div className="finance-filter-grid--5">
          <FinanceFormField
            label="Account"
            type="select"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            className="finance-field--flush"
          >
            <option value="">All Accounts</option>
            {accounts
              .filter((a) => !a.is_group)
              .map((a) => (
                <option key={a.name} value={a.name}>
                  {a.account_name} ({a.root_type})
                </option>
              ))}
          </FinanceFormField>
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
          <FinanceFormField
            label="Voucher Type"
            type="select"
            value={voucherType}
            onChange={(e) => setVoucherType(e.target.value)}
            className="finance-field--flush"
          >
            <option value="">All</option>
            {VOUCHER_TYPES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </FinanceFormField>
          <button type="button" className="pm-btn pm-btn-primary finance-filter-row__btn" onClick={load}>
            Apply
          </button>
        </div>
      </FinancePageHeader>

      <div className="finance-stat-grid finance-stat-grid--3 finance-stat-grid--equal finance-filter-grid--spaced">
        <FinanceKpiCard
          className="finance-stat-grid__item"
          label="Total Debit"
          value={fmtK(totalDr)}
          tone="success"
          onClick={kpiHandlers.total_debit}
        />
        <FinanceKpiCard
          className="finance-stat-grid__item"
          label="Total Credit"
          value={fmtK(totalCr)}
          tone="danger"
          onClick={kpiHandlers.total_credit}
        />
        <FinanceKpiCard
          className="finance-stat-grid__item"
          label="Net Balance"
          value={fmtK(netBalance)}
          accentClass="finance-stat-tile__value--accent"
          onClick={kpiHandlers.net_balance}
        />
      </div>

      <FinanceDataTable
        columns={columns}
        rows={entries}
        pageSize={FINANCE_LIST_PAGE_SIZE}
        loading={loading}
        emptyMessage="No entries found"
        getRowKey={(row, index) => `${row.voucher_no}-${row.posting_date}-${index}`}
        footer={footer}
        className="finance-data-table--wide"
      />
    </div>
  );
}
