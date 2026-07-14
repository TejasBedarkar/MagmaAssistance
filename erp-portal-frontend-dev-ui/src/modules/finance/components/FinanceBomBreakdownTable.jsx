import { financeFmt } from "../lib/financeFmt.js";

export default function FinanceBomBreakdownTable({
  items = [],
  total,
  emptyMessage = "No sub-products on this order.",
}) {
  if (!items.length) {
    return null;
  }

  const breakdownTotal =
    total != null ? Number(total) : items.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  return (
    <div className="finance-control-section finance-bom-section">
      <h3 className="finance-control-section__title finance-control-section__title--items">
        Sub-products (BOM)
      </h3>
      <p className="finance-detail-sub finance-text-sm--flush">
        Internal material breakdown — included in product price, not billed separately to the customer.
      </p>
      <div className="pm-table-wrap">
        <table className="pm-table finance-detail-table">
          <thead>
            <tr>
              {["Item code", "Name", "Qty", "Internal rate", "Cost"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((row, i) => (
              <tr key={i}>
                <td className="finance-cell-muted">{row.item_code}</td>
                <td className="finance-cell-title">{row.item_name || row.item_code}</td>
                <td>{row.required_qty ?? row.qty}</td>
                <td>{row.rate ? financeFmt(row.rate) : "—"}</td>
                <td className="finance-cell-accent">{financeFmt(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="finance-bom-section__total">
        <span>Material breakdown total</span>
        <strong>{financeFmt(breakdownTotal)}</strong>
      </div>
    </div>
  );
}
