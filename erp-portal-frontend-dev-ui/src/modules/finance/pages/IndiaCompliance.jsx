import { useEffect, useState, useCallback, useMemo } from "react";
import { callMethodGet } from "../../../common/api/client.js";
import FinanceDataTable from "../components/FinanceDataTable.jsx";
import FinanceDrillDownModal from "../components/FinanceDrillDownModal.jsx";
import FinanceKpiCard from "../components/FinanceKpiCard.jsx";
import FinanceFormField from "../components/FinanceFormField.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";
import FinancePageLoader from "../components/FinancePageLoader.jsx";
import { buildIndiaComplianceKpiDetail } from "../lib/indiaComplianceDrillDown.js";
import { defaultCompliancePeriodDates } from "../lib/reportDateDefaults.js";
import { toMethodGetUrl } from "../lib/methodUrl.js";
const fmt = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtK = (n) => {
  const v = Number(n || 0);
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(0)}k`;
  return `${sign}₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

const INITIAL_DATES = defaultCompliancePeriodDates();

const COMPLIANCE_KPIS = [
  { key: "output_gst", label: "Output GST (sales)" },
  { key: "input_gst", label: "Input GST (purchase)" },
  { key: "net_gst", label: "Net GST (approx)" },
  { key: "tds_withheld", label: "TDS withheld" },
];

export default function IndiaCompliance() {
  const [tab, setTab] = useState("gst");
  const [fromDate, setFromDate] = useState(INITIAL_DATES.fromDate);
  const [toDate, setToDate] = useState(INITIAL_DATES.toDate);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [drillDown, setDrillDown] = useState(null);

  const filterContext = useMemo(() => ({ fromDate, toDate }), [fromDate, toDate]);

  const openKpiDetail = useCallback(
    (kpiKey) => {
      const item = COMPLIANCE_KPIS.find((k) => k.key === kpiKey);
      setDrillDown(
        buildIndiaComplianceKpiDetail(kpiKey, data, filterContext) || {
          title: item?.label || "Details",
        }
      );
    },
    [data, filterContext]
  );

  const closeKpiDetail = useCallback(() => setDrillDown(null), []);

  const kpiHandlers = useMemo(
    () => Object.fromEntries(COMPLIANCE_KPIS.map((k) => [k.key, () => openKpiDetail(k.key)])),
    [openKpiDetail]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.india_compliance.get_compliance_dashboard", {
          from_date: fromDate,
          to_date: toDate,
        })
      );
      if (message) {
        setData(message);
      } else {
        setData(null);
        setError("Invalid compliance response from server.");
      }
    } catch (e) {
      setData(null);
      setError(e?.message || "Failed to load GST/TDS data. Check finance_app and company setup.");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    load();
  }, []);

  const gst = data?.gst || {};
  const output = gst.output || {};
  const input = gst.input || {};
  const tds = data?.tds || { rows: [], total_tds: 0 };

  const tabs = [
    { id: "gst", label: "GST summary" },
    { id: "tds", label: "TDS register" },
    { id: "sales", label: "Output tax (sales)" },
    { id: "purchase", label: "Input tax (purchase)" },
  ];

  const tdsColumns = useMemo(
    () => [
      {
        key: "invoice",
        label: "Invoice",
        render: (r) => <span className="finance-cell-accent">{r.invoice}</span>,
      },
      {
        key: "supplier",
        label: "Supplier",
        render: (r) => r.supplier_name || r.supplier,
      },
      {
        key: "posting_date",
        label: "Date",
        render: (r) => <span className="finance-cell-muted">{r.posting_date}</span>,
      },
      {
        key: "category",
        label: "TDS category",
        render: (r) => r.category || "—",
      },
      {
        key: "taxable_amount",
        label: "Taxable",
        render: (r) => fmt(r.taxable_amount),
      },
      {
        key: "tds_amount",
        label: "TDS amount",
        render: (r) => <span className="finance-cell-danger">{fmt(r.tds_amount)}</span>,
      },
      {
        key: "grand_total",
        label: "Grand total",
        render: (r) => fmt(r.grand_total),
      },
    ],
    []
  );

  return (
    <div className="pm-page finance-page">
      {drillDown ? <FinanceDrillDownModal detail={drillDown} loading={false} onClose={closeKpiDetail} /> : null}

      <FinancePageHeader
        title="India GST / TDS Compliance"
        description="GST output (sales) vs input (purchase) and TDS withheld on supplier bills. Uses submitted invoices and tax lines from ERPNext."
        meta={
          data?.company ? (
            <>
              Company: <strong className="finance-cell-title">{data.company}</strong>
              {data.company_gstin ? (
                <>
                  {" "}
                  · GSTIN: <strong className="finance-cell-title">{data.company_gstin}</strong>
                </>
              ) : null}
              {data.from_date && data.to_date ? (
                <>
                  {" "}
                  · Period: {data.from_date} to {data.to_date}
                </>
              ) : null}
            </>
          ) : null
        }
        note={data?.note || undefined}
      >
        <div className="finance-filter-row finance-filter-row--triple finance-filter-row--max-520">
          <FinanceFormField
            label="From date"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="finance-field--flush"
          />
          <FinanceFormField
            label="To date"
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

      {loading ? (
        <FinancePageLoader message="Loading compliance data…" />
      ) : error ? (
        <div className="finance-center-state finance-center-state--col">
          <span className="finance-center-state__icon">⚠️</span>
          <p className="finance-center-state__error">{error}</p>
          <button type="button" className="pm-btn pm-btn-primary" onClick={load}>
            Retry
          </button>
        </div>
      ) : data?.status === "error" ? (
        <div className="pm-empty finance-cell-danger">{data.message}</div>
      ) : (
        <>
          <div className="finance-stat-grid finance-stat-grid--equal finance-filter-grid--spaced">
            <FinanceKpiCard
              className="finance-stat-grid__item"
              label="Output GST (sales)"
              value={fmtK(output.total)}
              accentClass="finance-stat-tile__value--success"
              onClick={kpiHandlers.output_gst}
            />
            <FinanceKpiCard
              className="finance-stat-grid__item"
              label="Input GST (purchase)"
              value={fmtK(input.total)}
              accentClass="finance-stat-tile__value--accent"
              onClick={kpiHandlers.input_gst}
            />
            <FinanceKpiCard
              className="finance-stat-grid__item"
              label="Net GST (approx)"
              value={fmtK(gst.net_payable)}
              accentClass={gst.net_payable > 0 ? "finance-stat-tile__value--warning" : "finance-stat-tile__value--success"}
              onClick={kpiHandlers.net_gst}
            />
            <FinanceKpiCard
              className="finance-stat-grid__item"
              label="TDS withheld"
              value={fmtK(tds.total_tds)}
              accentClass="finance-stat-tile__value--danger"
              onClick={kpiHandlers.tds_withheld}
            />
          </div>

          <div className="finance-tab-bar">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`finance-tab-btn ${tab === t.id ? "finance-tab-btn--active" : "finance-tab-btn--inactive"}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "gst" && (
            <div className="finance-chart-grid">
              <GstBreakdown title="Output GST (Sales Invoices)" buckets={output} />
              <GstBreakdown title="Input GST (Purchase Invoices)" buckets={input} />
            </div>
          )}

          {tab === "tds" && (
            <FinanceDataTable
              columns={tdsColumns}
              rows={tds.rows || []}
              emptyMessage="No TDS purchase invoices in this period (enable Apply TDS on purchase invoices)."
              getRowKey={(row) => row.invoice}
              className="finance-data-table--medium"
              tableClassName="finance-table--compact"
            />
          )}

          {tab === "sales" && <InvoiceTaxTable rows={data?.sales_invoices || []} partyLabel="Customer" />}
          {tab === "purchase" && (
            <InvoiceTaxTable rows={data?.purchase_invoices || []} partyLabel="Supplier" showTds />
          )}
        </>
      )}
    </div>
  );
}

function GstBreakdown({ title, buckets }) {
  const rows = [
    { label: "CGST", key: "cgst" },
    { label: "SGST / UTGST", key: "sgst" },
    { label: "IGST", key: "igst" },
    { label: "Cess", key: "cess" },
    { label: "Other tax", key: "other" },
    { label: "Total", key: "total", bold: true },
  ];
  return (
    <div className="pm-card">
      <h3 className="finance-section-title finance-section-title--card">{title}</h3>
      {rows.map((r) => (
        <div
          key={r.key}
          className={`finance-breakdown-row ${r.bold ? "finance-breakdown-row--bold" : "finance-breakdown-row--normal"}`}
        >
          <span className={r.bold ? "finance-breakdown-label--bold" : "finance-breakdown-label"}>{r.label}</span>
          <span className="finance-text-sm">{fmt(buckets[r.key])}</span>
        </div>
      ))}
    </div>
  );
}

function InvoiceTaxTable({ rows, partyLabel, showTds }) {
  const columns = useMemo(() => {
    const cols = [
      {
        key: "name",
        label: "Invoice",
        render: (inv) => <span className="finance-cell-accent">{inv.name}</span>,
      },
      {
        key: "party",
        label: partyLabel,
        render: (inv) => inv.party,
      },
      {
        key: "posting_date",
        label: "Date",
        render: (inv) => <span className="finance-cell-muted">{inv.posting_date}</span>,
      },
      {
        key: "taxes_and_charges",
        label: "Tax template",
        render: (inv) => <span className="finance-cell-muted finance-text-xs">{inv.taxes_and_charges || "—"}</span>,
      },
      {
        key: "total_taxes",
        label: "Tax total",
        render: (inv) => <span className="finance-cell-title">{fmt(inv.total_taxes)}</span>,
      },
      {
        key: "grand_total",
        label: "Grand total",
        render: (inv) => fmt(inv.grand_total),
      },
    ];
    if (showTds) {
      cols.push({
        key: "apply_tds",
        label: "TDS",
        render: (inv) => (inv.apply_tds ? "Yes" : "—"),
      });
    }
    return cols;
  }, [partyLabel, showTds]);

  return (
    <FinanceDataTable
      columns={columns}
      rows={rows}
      emptyMessage="No submitted invoices in this period."
      getRowKey={(row) => row.name}
      className="finance-data-table--aging"
      tableClassName="finance-table--compact"
    />
  );
}
