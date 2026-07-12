import { financeFmt } from "../lib/financeFmt.js";

export default function FinanceItemsTable({
  items = [],
  qtyKey = "qty",
  showHsn = false,
  emptyMessage = "No items on this document.",
}) {
  if (!items.length) {
    return <p className="finance-cell-muted finance-text-sm--flush">{emptyMessage}</p>;
  }

  const headers = showHsn ? ["Item", "HSN/SAC", "Qty", "Rate", "Amount"] : ["Item", "Qty", "Rate", "Amount"];

  return (
    <div className="pm-table-wrap">
      <table className="pm-table finance-detail-table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td className="finance-cell-title">{it.item_name || it.item_code}</td>
              {showHsn ? (
                <td className={it.hsn_code ? "" : "finance-cell-warning"}>{it.hsn_code || "—"}</td>
              ) : null}
              <td>{it[qtyKey] ?? it.qty}</td>
              <td>{financeFmt(it.rate)}</td>
              <td className="finance-cell-accent">{financeFmt(it.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
