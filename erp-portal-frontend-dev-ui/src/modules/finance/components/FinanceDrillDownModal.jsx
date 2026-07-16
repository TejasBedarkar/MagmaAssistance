import { useEffect } from "react";
import FinancePageLoader from "./FinancePageLoader.jsx";

const fmt = (n) =>
  `₹ ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function FinanceDetailTable({ columns, rows }) {
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
            <tr key={row.name || row.label || i}>
              {columns.map((c) => {
                const val = row[c.key];
                const display = c.format === "currency" ? fmt(val) : (val ?? "—");
                return (
                  <td
                    key={c.key}
                    className={[
                      c.align === "right" ? "finance-cell-align-right" : "finance-cell-align-left",
                      c.key === "name" || c.key === "label" ? "finance-cell-title" : "",
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

/** KPI / report drill-down modal — same pattern as finance Dashboard. */
export default function FinanceDrillDownModal({ detail, loading, onClose }) {
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
            {!loading && detail?.count == null && detail?.total != null && (
              <p className="pm-field-hint finance-drill-modal__count">
                Total: <strong className="finance-cell-title">{fmt(detail.total)}</strong>
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
                  {sec.total != null && (
                    <span className={`finance-text-sm ${idx === 0 ? "finance-cell-success" : "finance-cell-danger"}`}>
                      {fmt(sec.total)}
                    </span>
                  )}
                </div>
                <FinanceDetailTable columns={sec.columns} rows={sec.rows} />
              </div>
            ))}
          {!loading && detail?.columns && (
            <FinanceDetailTable columns={detail.columns} rows={detail.rows} />
          )}
        </div>
      </div>
    </div>
  );
}
