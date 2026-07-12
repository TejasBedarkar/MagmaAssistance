import { useEffect, useState, useCallback, useMemo } from "react";
import { callMethodGet } from "../../../common/api/client.js";
import { defaultAsOnDate } from "../lib/reportDateDefaults.js";
import { toMethodGetUrl } from "../lib/methodUrl.js";
import FinanceDataTable, { FINANCE_LIST_PAGE_SIZE } from "../components/FinanceDataTable.jsx";
import FinanceFormField from "../components/FinanceFormField.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";

const fmt = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COLS = [
  { key: "current", label: "Not yet due" },
  { key: "range0_30", label: "0–30 days past due" },
  { key: "range31_60", label: "31–60 days" },
  { key: "range61_90", label: "61–90 days" },
  { key: "range90_plus", label: "90+ days" },
  { key: "total_outstanding", label: "Total outstanding" },
];

function amountCell(value, isTotalCol) {
  if (!(value > 0)) return "—";
  return (
    <span
      className={
        isTotalCol ? "finance-aging-amount--total finance-cell-success" : "finance-aging-amount"
      }
    >
      {fmt(value)}
    </span>
  );
}

export default function CustomerAging() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reportDate, setReportDate] = useState(defaultAsOnDate());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { report_date: reportDate };
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.customer_aging.get_customer_aging", params)
      );
      setData(message || null);
    } catch {
      setData(null);
    }
    setLoading(false);
  }, [reportDate]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = data?.rows || [];
  const totals = data?.totals || {};

  const columns = useMemo(
    () => [
      {
        key: "customer",
        label: "Customer",
        render: (row) => (
          <>
            <div className="finance-cell-title">{row.customer_name || row.customer}</div>
            <div className="finance-party-label finance-party-label--sub">{row.customer}</div>
          </>
        ),
      },
      ...COLS.map((col) => ({
        key: col.key,
        label: col.label,
        align: "right",
        headerClassName: "finance-th-aging",
        render: (row) => amountCell(row[col.key], col.key === "total_outstanding"),
      })),
    ],
    []
  );

  const footer = (
    <>
      <td className="finance-footer-label finance-footer-label--left">TOTAL</td>
      {COLS.map((col) => {
        const value = totals[col.key];
        const isTotalCol = col.key === "total_outstanding";
        return (
          <td
            key={col.key}
            className={`finance-footer-total finance-footer-total--compact ${
              isTotalCol ? "finance-footer-total--total-col finance-cell-success" : ""
            }`}
          >
            {value > 0 ? fmt(value) : "—"}
          </td>
        );
      })}
    </>
  );

  return (
    <div className="pm-page finance-page">
      <FinancePageHeader
        description={
          <>
            Outstanding per customer from <strong>Sales Invoices</strong>, split by how far past the invoice{" "}
            <strong>due date</strong> the report date is. “Not yet due” means due date is after the report date.
          </>
        }
        meta={
          data?.company ? (
            <>
              Company: <strong className="finance-cell-title">{data.company}</strong>
              {data.as_on_date ? (
                <>
                  {" "}
                  · As on: <strong className="finance-cell-title">{data.as_on_date}</strong>
                </>
              ) : null}
            </>
          ) : null
        }
        note={data?.note || undefined}
      >
        <div className="finance-filter-row">
          <FinanceFormField
            label="Age as on (report date)"
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            className="finance-field--flush"
          />
          <button type="button" className="pm-btn pm-btn-primary finance-filter-row__btn" onClick={load}>
            Refresh
          </button>
        </div>
      </FinancePageHeader>

      <FinanceDataTable
        columns={columns}
        rows={rows}
        pageSize={FINANCE_LIST_PAGE_SIZE}
        loading={loading}
        emptyMessage="No outstanding receivables from sales invoices for this company and date."
        getRowKey={(row) => row.customer}
        footer={footer}
        className="finance-data-table--aging"
        tableClassName="finance-table--compact"
      />
    </div>
  );
}
